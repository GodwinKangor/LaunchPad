import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeployError, type RouteTarget, type Router } from '../lib/engine/types';
import { errorMessage } from '../lib/errors';
import { projectNameSchema } from '../lib/validation';

export interface CaddyRouterOptions {
  /** Directory of per-project snippets that the Caddyfile imports. Shared with the Caddy container. */
  routesDir: string;
  domain: string;
  scheme: 'http' | 'https';
  /** Asks Caddy to load the configuration. Must reject if Caddy refuses it. */
  reload: () => Promise<void>;
}

/**
 * One Caddyfile snippet per project. Only validated names reach this
 * function: project names are DNS labels and container names are generated.
 */
export function renderRoute(projectName: string, target: RouteTarget, options: Pick<CaddyRouterOptions, 'domain' | 'scheme'>): string {
  if (!projectNameSchema.safeParse(projectName).success) throw new Error('Refusing to write a route for an invalid project name');
  const host = `${projectName}.${options.domain}`;
  // An explicit http:// address disables automatic HTTPS for that site; a bare hostname lets Caddy obtain a certificate.
  const address = options.scheme === 'https' ? host : `http://${host}`;
  if (target.kind === 'stopped') {
    return `${address} {\n\trespond "This application is stopped." 503\n}\n`;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(target.container) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new Error('Refusing to write a route for an invalid upstream');
  }
  return `${address} {\n\treverse_proxy ${target.container}:${target.port}\n}\n`;
}

/**
 * Routes subdomains by writing snippet files and asking Caddy to reload.
 * Reloads are graceful (no dropped connections), and Caddy keeps its running
 * configuration if the new one is rejected.
 */
export class CaddyRouter implements Router {
  /** Reloads are serialised: two projects finishing at once must not interleave write and reload. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: CaddyRouterOptions) {}

  private file(projectName: string): string {
    return path.join(this.options.routesDir, `${projectName}.caddy`);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(file: string, content: string | null): Promise<void> {
    if (content === null) {
      await rm(file, { force: true });
      return;
    }
    await writeFile(`${file}.tmp`, content, { mode: 0o644 });
    await rename(`${file}.tmp`, file);
  }

  setRoute(projectName: string, target: RouteTarget | null): Promise<void> {
    return this.serial(async () => {
      const content = target ? renderRoute(projectName, target, this.options) : null;
      const file = this.file(projectName);
      await mkdir(this.options.routesDir, { recursive: true });
      const previous = await readFile(file, 'utf8').catch(() => null);
      if (previous === content) return;
      await this.write(file, content);
      try {
        await this.options.reload();
      } catch (err) {
        // Put the old snippet back so the files on disk match what Caddy is still serving.
        await this.write(file, previous).catch(() => undefined);
        console.error(`[caddy] reload failed for ${projectName}: ${errorMessage(err)}`);
        throw new DeployError('Routing could not be updated: the proxy did not accept the new configuration.');
      }
    });
  }

  prune(keepProjectNames: string[]): Promise<void> {
    return this.serial(async () => {
      const keep = new Set(keepProjectNames.map((name) => `${name}.caddy`));
      const entries = await readdir(this.options.routesDir).catch(() => [] as string[]);
      const stale = entries.filter((entry) => entry.endsWith('.caddy') && !keep.has(entry));
      if (stale.length === 0) return;
      for (const entry of stale) await rm(path.join(this.options.routesDir, entry), { force: true });
      await this.options.reload();
    });
  }
}
