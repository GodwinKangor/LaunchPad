import { encryptValue, envAad } from '@/lib/crypto';
import { MemoryLocks } from '@/lib/engine/locks';
import {
  DeployError,
  type ContainerDriver,
  type ContainerInfo,
  type EngineDeps,
  type HealthResult,
  type LogFn,
  type RouteTarget,
  type Router,
  type RunSpec,
} from '@/lib/engine/types';
import { MemoryStore } from '@/lib/store/memory';
import type { DeploymentState, Project } from '@/lib/types';
import { TEST_CONFIG } from './helpers';

/** In-memory stand-in for Docker that records what the engine asked for. */
export class FakeDriver implements ContainerDriver {
  calls: string[] = [];
  containers = new Map<string, ContainerInfo>();
  images = new Set<string>();
  workspaces = new Set<string>();
  runs: RunSpec[] = [];
  promoted: string[] = [];
  appLogs: string[] = [];

  buildError: Error | null = null;
  runError: Error | null = null;
  health: HealthResult = { ok: true };
  buildOutput: string[] = [];
  /** Runs in the middle of a build; lets a test act while a deployment is in flight. */
  duringBuild: (() => Promise<void>) | null = null;
  private commits = 0;

  async checkout(input: { deploymentId: string }, log: LogFn) {
    this.calls.push('checkout');
    this.workspaces.add(input.deploymentId);
    log('Cloning into workspace');
    return { commitSha: (++this.commits).toString(16).padStart(40, '0') };
  }

  async build(input: { image: string }, log: LogFn) {
    this.calls.push('build');
    for (const line of this.buildOutput) log(line);
    await this.duringBuild?.();
    if (this.buildError) throw this.buildError;
    this.images.add(input.image);
  }

  async cleanupWorkspace(deploymentId: string) {
    this.workspaces.delete(deploymentId);
  }

  async imageExists(image: string) {
    return this.images.has(image);
  }

  async removeImage(image: string) {
    this.calls.push(`rmi ${image}`);
    this.images.delete(image);
  }

  async run(spec: RunSpec) {
    this.calls.push('run');
    this.runs.push(spec);
    // Like Docker, a container that fails to start still exists and must be removed.
    this.containers.set(spec.name, { name: spec.name, projectId: spec.projectId, deploymentId: spec.deploymentId, running: !this.runError });
    if (this.runError) throw this.runError;
  }

  async waitHealthy() {
    this.calls.push('health');
    return this.health;
  }

  async promote(name: string) {
    this.promoted.push(name);
  }

  async removeContainer(name: string) {
    this.calls.push(`rm ${name}`);
    this.containers.delete(name);
  }

  async listContainers() {
    return [...this.containers.values()];
  }

  async logs() {
    return this.appLogs;
  }

  running(projectId: string): string[] {
    return [...this.containers.values()].filter((c) => c.projectId === projectId && c.running).map((c) => c.name);
  }
}

export class FakeRouter implements Router {
  routes = new Map<string, RouteTarget>();
  history: { project: string; target: RouteTarget | null }[] = [];
  failNext = false;

  async setRoute(projectName: string, target: RouteTarget | null) {
    if (this.failNext) {
      this.failNext = false;
      throw new DeployError('Routing update failed: the proxy rejected the new configuration.');
    }
    this.history.push({ project: projectName, target });
    if (target) this.routes.set(projectName, target);
    else this.routes.delete(projectName);
  }

  async prune(keep: string[]) {
    for (const name of [...this.routes.keys()]) if (!keep.includes(name)) this.routes.delete(name);
  }

  upstream(projectName: string): string | null {
    const target = this.routes.get(projectName);
    return target?.kind === 'upstream' ? target.container : null;
  }
}

export interface Harness {
  store: MemoryStore;
  driver: FakeDriver;
  router: FakeRouter;
  deps: EngineDeps;
  /** Every state a deployment was moved into, in order. */
  transitions: Map<string, DeploymentState[]>;
  project(overrides?: Partial<{ name: string; port: number; healthPath: string }>): Promise<Project>;
  setEnv(projectId: string, env: Record<string, string>): Promise<void>;
  logText(deploymentId: string): Promise<string>;
}

export function harness(settings: Partial<EngineDeps['settings']> = {}): Harness {
  const store = new MemoryStore();
  const driver = new FakeDriver();
  const router = new FakeRouter();
  const transitions = new Map<string, DeploymentState[]>();

  const record = (id: string, state: DeploymentState) => transitions.set(id, [...(transitions.get(id) ?? []), state]);
  const transition = store.transitionDeployment.bind(store);
  store.transitionDeployment = async (id, from, to, patch) => {
    const result = await transition(id, from, to, patch);
    if (result) record(id, to);
    return result;
  };
  const promote = store.promoteDeployment.bind(store);
  store.promoteDeployment = async (id, patch) => {
    const result = await promote(id, patch);
    if (result) record(id, 'healthy');
    return result;
  };

  return {
    store,
    driver,
    router,
    transitions,
    deps: {
      store,
      driver,
      router,
      locks: new MemoryLocks(),
      encryptionKey: TEST_CONFIG.encryptionKey,
      settings: { healthTimeoutMs: 1_000, retainedReleases: 3, maxBuildLogLines: 200, ...settings },
    },
    project: (overrides = {}) =>
      store.createProject({ ownerId: 'owner', name: 'blog', repoUrl: 'https://github.com/me/blog.git', branch: 'main', rootDirectory: '', port: 3000, healthPath: '/', ...overrides }),
    setEnv: (projectId, env) =>
      store.applyEnv(
        projectId,
        Object.entries(env).map(([key, value]) => ({ key, ciphertext: encryptValue(value, TEST_CONFIG.encryptionKey, envAad(projectId, key)) })),
        [],
      ),
    logText: async (deploymentId) => (await store.getLogs(deploymentId, 0, 10_000)).map((l) => l.message).join('\n'),
  };
}
