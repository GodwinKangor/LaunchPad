import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { WorkerConfig } from '../lib/config';
import { pollHealth } from '../lib/engine/health';
import { DeployError, type ContainerDriver, type ContainerInfo, type HealthResult, type LogFn, type RunSpec } from '../lib/engine/types';
import { formatDuration } from '../lib/format';
import { branchSchema, parseRepoUrl } from '../lib/validation';
import { CommandError, exec } from './exec';

const MANAGED_LABEL = 'launchpad.managed';
const PROJECT_LABEL = 'launchpad.project';
const DEPLOYMENT_LABEL = 'launchpad.deployment';

/** Capabilities a typical web server image needs to drop privileges and bind its port. Everything else is removed. */
const CAPABILITIES = ['CHOWN', 'SETGID', 'SETUID', 'NET_BIND_SERVICE'];

/**
 * The container definition sent to the Docker Engine API. Kept as a pure
 * function so tests can assert the sandbox: never privileged, no host mounts
 * (so no Docker socket), no published host ports, hard resource limits.
 */
export function containerSpec(spec: RunSpec, config: Pick<WorkerConfig, 'appNetwork' | 'limits'>) {
  const memoryBytes = config.limits.memoryMb * 1024 * 1024;
  return {
    Image: spec.image,
    Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
    Labels: { [MANAGED_LABEL]: 'true', [PROJECT_LABEL]: spec.projectId, [DEPLOYMENT_LABEL]: spec.deploymentId },
    HostConfig: {
      NetworkMode: config.appNetwork,
      Privileged: false,
      Binds: [] as string[],
      PortBindings: {},
      Init: true,
      // No restart policy until the health check has passed, so a crashing release fails fast.
      RestartPolicy: { Name: 'no' },
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(Number(config.limits.cpus) * 1e9),
      PidsLimit: config.limits.pids,
      CapDrop: ['ALL'],
      CapAdd: CAPABILITIES,
      SecurityOpt: ['no-new-privileges'],
      LogConfig: { Type: 'json-file', Config: { 'max-size': config.limits.logMaxSize, 'max-file': String(config.limits.logMaxFiles) } },
    },
  };
}

/** Arguments for `git clone`. Everything user-controlled comes after `--`, and helpers that could run code are disabled. */
export function cloneArgs(repoUrl: string, branch: string, dir: string): string[] {
  return [
    '-c', 'credential.helper=',
    '-c', 'protocol.file.allow=never',
    '-c', 'core.hooksPath=/dev/null',
    'clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', repoUrl, dir,
  ];
}

const isMissing = (err: unknown) => err instanceof CommandError && /no such (container|image|object)/i.test(err.stderr);

export class DockerDriver implements ContainerDriver {
  private readonly socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

  constructor(private readonly config: WorkerConfig) {}

  private workspace(deploymentId: string): string {
    if (!/^[a-f0-9]{24}$/.test(deploymentId)) throw new Error('Invalid deployment id');
    return path.join(this.config.buildDir, deploymentId);
  }

  /**
   * Container creation goes through the Engine API rather than `docker run`
   * so environment values travel in a request body, not in a process
   * argument list that other processes on the host could read.
   */
  private api(method: string, apiPath: string, body?: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          socketPath: this.socketPath,
          method,
          path: apiPath,
          headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined,
          timeout: 60_000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('Docker API request timed out')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  async checkout(input: { deploymentId: string; repoUrl: string; branch: string }, log: LogFn): Promise<{ commitSha: string }> {
    // Validated when saved; validated again here because this is the point where the values reach git.
    if (parseRepoUrl(input.repoUrl)?.url !== input.repoUrl) throw new DeployError('The repository URL is not a supported GitHub URL.');
    if (!branchSchema.safeParse(input.branch).success) throw new DeployError('The branch name is not valid.');

    const dir = this.workspace(input.deploymentId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(this.config.buildDir, { recursive: true });
    const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ASKPASS: '/bin/false' };
    try {
      await exec('git', cloneArgs(input.repoUrl, input.branch, dir), { env, timeoutMs: this.config.cloneTimeoutMs, onLine: log });
    } catch (err) {
      if (err instanceof CommandError && err.timedOut) throw new DeployError(`Cloning took longer than ${formatDuration(this.config.cloneTimeoutMs)} and was stopped.`);
      if (err instanceof CommandError && err.exitCode !== null) {
        throw new DeployError(`Could not clone branch "${input.branch}". Check that the repository is public and the branch exists. (${err.lastLine || 'git clone failed'})`);
      }
      throw err;
    }
    const { stdout } = await exec('git', ['-C', dir, 'rev-parse', 'HEAD'], { env, timeoutMs: 15_000 });
    const commitSha = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('git returned an unexpected commit id');
    return { commitSha };
  }

  async build(input: { deploymentId: string; projectId: string; rootDirectory: string; image: string }, log: LogFn): Promise<void> {
    const root = await realpath(this.workspace(input.deploymentId));
    const where = input.rootDirectory ? `the "${input.rootDirectory}" folder` : 'the repository root';
    const context = await realpath(path.join(root, input.rootDirectory)).catch(() => null);
    // realpath resolves symlinks, so a link pointing outside the checkout is caught here.
    if (!context || (context !== root && !context.startsWith(root + path.sep))) throw new DeployError(`Could not find ${where} in the repository.`);
    const dockerfile = path.join(context, 'Dockerfile');
    const stat = await lstat(dockerfile).catch(() => null);
    if (!stat?.isFile()) throw new DeployError(`No Dockerfile found in ${where}.`);

    const args = [
      'build', '--progress', 'plain',
      '--tag', input.image,
      '--label', `${MANAGED_LABEL}=true`,
      '--label', `${PROJECT_LABEL}=${input.projectId}`,
      '--file', dockerfile,
      context,
    ];
    try {
      await exec('docker', args, { env: { DOCKER_BUILDKIT: '1' }, timeoutMs: this.config.buildTimeoutMs, onLine: log });
    } catch (err) {
      if (err instanceof CommandError && err.timedOut) throw new DeployError(`The build took longer than ${formatDuration(this.config.buildTimeoutMs)} and was stopped.`);
      if (err instanceof CommandError && err.exitCode !== null) throw new DeployError('The Docker build failed. See the build log for the failing step.');
      throw err;
    }
  }

  async cleanupWorkspace(deploymentId: string): Promise<void> {
    await rm(this.workspace(deploymentId), { recursive: true, force: true });
  }

  async imageExists(image: string): Promise<boolean> {
    try {
      await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 30_000 });
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async removeImage(image: string): Promise<void> {
    try {
      await exec('docker', ['image', 'rm', image], { timeoutMs: 60_000 });
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  async run(spec: RunSpec): Promise<void> {
    const created = await this.api('POST', `/containers/create?name=${encodeURIComponent(spec.name)}`, containerSpec(spec, this.config));
    // Docker's error text can echo parts of the request; report the status only, the env must not reach logs.
    if (created.status !== 201) throw new Error(`Docker refused to create the container (HTTP ${created.status})`);
    const started = await this.api('POST', `/containers/${encodeURIComponent(spec.name)}/start`);
    if (started.status !== 204 && started.status !== 304) {
      let detail = '';
      try {
        detail = (JSON.parse(started.body) as { message?: string }).message ?? '';
      } catch {
        /* non-JSON error body */
      }
      throw new DeployError(`The container could not be started. ${detail}`.trim());
    }
  }

  private async state(name: string): Promise<{ running: boolean; detail?: string }> {
    try {
      const { stdout } = await exec('docker', ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}', name], { timeoutMs: 30_000 });
      const [running, exitCode, oom] = stdout.trim().split(' ');
      if (running === 'true') return { running: true };
      return { running: false, detail: oom === 'true' ? `out of memory, limit is ${this.config.limits.memoryMb} MB` : `exit code ${exitCode}` };
    } catch (err) {
      if (isMissing(err)) return { running: false, detail: 'container no longer exists' };
      throw err;
    }
  }

  /** The worker shares the app network, so the container is reachable by name. Nothing is published on the host. */
  async waitHealthy(input: { name: string; port: number; path: string; timeoutMs: number }, log: LogFn): Promise<HealthResult> {
    const url = `http://${input.name}:${input.port}${input.path}`;
    return pollHealth(
      {
        state: () => this.state(input.name),
        request: async () => {
          try {
            const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
            await res.body?.cancel();
            return res.status;
          } catch {
            return null;
          }
        },
      },
      { timeoutMs: input.timeoutMs, path: input.path, port: input.port },
      log,
    );
  }

  async promote(name: string): Promise<void> {
    await exec('docker', ['update', '--restart', 'unless-stopped', name], { timeoutMs: 30_000 });
  }

  async removeContainer(name: string): Promise<void> {
    try {
      await exec('docker', ['rm', '--force', '--volumes', name], { timeoutMs: 60_000 });
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  async listContainers(): Promise<ContainerInfo[]> {
    const format = `{{.Names}}\t{{.Label "${PROJECT_LABEL}"}}\t{{.Label "${DEPLOYMENT_LABEL}"}}\t{{.State}}`;
    const { stdout } = await exec('docker', ['ps', '--all', '--no-trunc', '--filter', `label=${MANAGED_LABEL}=true`, '--format', format], { timeoutMs: 30_000 });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, projectId, deploymentId, state] = line.split('\t');
        return { name, projectId, deploymentId, running: state === 'running' };
      });
  }

  async logs(name: string, tail: number): Promise<string[]> {
    try {
      const { stdout, stderr } = await exec('docker', ['logs', '--timestamps', '--tail', String(tail), name], { timeoutMs: 30_000 });
      // Docker replays the app's stdout and stderr on separate streams; merge them back by timestamp.
      return `${stdout}\n${stderr}`.split('\n').filter(Boolean).sort().slice(-tail);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }
}
