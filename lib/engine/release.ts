import { decryptValue, envAad } from '../crypto';
import { errorMessage } from '../errors';
import type { Deployment, Project } from '../types';
import { containerName } from './names';
import { DeployError, type EngineDeps, type LogFn, type RouteTarget } from './types';

/** Decrypts the project's environment. PORT always reflects the configured port. */
export async function resolveEnv(deps: EngineDeps, project: Project): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const variable of await deps.store.listEnv(project.id)) {
    try {
      env[variable.key] = decryptValue(variable.ciphertext, deps.encryptionKey, envAad(project.id, variable.key));
    } catch {
      throw new DeployError(`Could not decrypt environment variable ${variable.key}. Check that ENV_ENCRYPTION_KEY matches the key used to save it, or set the value again.`);
    }
  }
  env.PORT = String(project.port);
  return env;
}

/**
 * Starts a new container for `image` and waits until it is healthy. The
 * container receives no traffic yet. If anything goes wrong the container is
 * removed before the error propagates, so a failed start leaves nothing behind.
 */
export async function startRelease(
  deps: EngineDeps,
  project: Project,
  deployment: Deployment,
  image: string,
  env: Record<string, string>,
  redact: (text: string) => string,
  log: LogFn,
): Promise<string> {
  const name = containerName(project, deployment);
  try {
    log(`Starting container on port ${project.port}`);
    await deps.driver.run({ name, image, port: project.port, env, projectId: project.id, deploymentId: deployment.id });
    log(`Waiting for a healthy response from ${project.healthPath}`);
    const health = await deps.driver.waitHealthy({ name, port: project.port, path: project.healthPath, timeoutMs: deps.settings.healthTimeoutMs }, log);
    if (!health.ok) {
      const tail = await deps.driver.logs(name, 30).catch(() => []);
      if (tail.length > 0) {
        log('Last output from the application:');
        for (const line of tail) log(`  ${redact(line)}`);
      }
      throw new DeployError(`Health check failed: ${health.reason}`);
    }
    await deps.driver.promote(name);
    return name;
  } catch (err) {
    await deps.driver.removeContainer(name).catch((cleanupErr) => console.error(`[engine] could not remove ${name}: ${errorMessage(cleanupErr)}`));
    throw err;
  }
}

/** Where the project's hostname should point according to the database. */
export async function recordedRoute(deps: EngineDeps, project: Project): Promise<RouteTarget | null> {
  if (project.status === 'stopped') return { kind: 'stopped' };
  if (project.status !== 'running' && project.status !== 'crashed') return null;
  const active = project.activeDeploymentId ? await deps.store.getDeployment(project.activeDeploymentId) : null;
  return active?.containerName ? { kind: 'upstream', container: active.containerName, port: project.port } : null;
}

/** Removes every container of the project except `keep`. This is what guarantees a single live container per project. */
export async function removeOtherContainers(deps: EngineDeps, projectId: string, keep: string | null): Promise<void> {
  const containers = await deps.driver.listContainers();
  for (const container of containers) {
    if (container.projectId === projectId && container.name !== keep) await deps.driver.removeContainer(container.name);
  }
}

/** Keeps the active image plus the most recent `retainedReleases` distinct healthy images; deletes the rest. */
export async function pruneImages(deps: EngineDeps, projectId: string): Promise<void> {
  const project = await deps.store.getProject(projectId);
  if (!project) return;
  const healthy = (await deps.store.listDeployments(projectId, 500)).filter((d) => d.state === 'healthy' && d.imageRetained && d.image);
  const keep = new Set<string>();
  const active = healthy.find((d) => d.id === project.activeDeploymentId);
  if (active?.image) keep.add(active.image);
  for (const deployment of healthy) {
    if (keep.size > deps.settings.retainedReleases) break;
    keep.add(deployment.image!);
  }
  const removed = new Set<string>();
  for (const deployment of healthy) {
    const image = deployment.image!;
    if (keep.has(image)) continue;
    if (!removed.has(image)) {
      await deps.driver.removeImage(image);
      removed.add(image);
    }
    await deps.store.updateDeployment(deployment.id, { imageRetained: false });
  }
}
