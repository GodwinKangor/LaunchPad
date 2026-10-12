import type { Store } from '../store/types';

/**
 * The deployment engine is written against these interfaces only. The worker
 * plugs in Docker, Caddy and Redis; demo mode plugs in a simulator; tests plug
 * in fakes. The dashboard process never loads the Docker implementations.
 */

/** A failure with a message written for the project owner (bad Dockerfile, failed health check, ...). */
export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployError';
  }
}

export type LogFn = (line: string) => void;

export interface RunSpec {
  name: string;
  image: string;
  port: number;
  env: Record<string, string>;
  projectId: string;
  deploymentId: string;
}

export interface ContainerInfo {
  name: string;
  projectId: string;
  deploymentId: string;
  running: boolean;
}

export type HealthResult = { ok: true } | { ok: false; reason: string };

export interface ContainerDriver {
  /** Clones the branch into a fresh per-deployment workspace and returns the exact commit. */
  checkout(input: { deploymentId: string; repoUrl: string; branch: string }, log: LogFn): Promise<{ commitSha: string }>;
  build(input: { deploymentId: string; projectId: string; rootDirectory: string; image: string }, log: LogFn): Promise<void>;
  /** Idempotent. */
  cleanupWorkspace(deploymentId: string): Promise<void>;
  imageExists(image: string): Promise<boolean>;
  /** Idempotent. */
  removeImage(image: string): Promise<void>;
  /** Creates and starts a container that is not yet receiving traffic and will not auto-restart. */
  run(spec: RunSpec): Promise<void>;
  waitHealthy(input: { name: string; port: number; path: string; timeoutMs: number }, log: LogFn): Promise<HealthResult>;
  /** Called once a container passed its health check: from here on it should survive crashes and reboots. */
  promote(name: string): Promise<void>;
  /** Idempotent. */
  removeContainer(name: string): Promise<void>;
  /** Every container LaunchPad manages, running or not. */
  listContainers(): Promise<ContainerInfo[]>;
  logs(name: string, tail: number): Promise<string[]>;
}

export type RouteTarget = { kind: 'upstream'; container: string; port: number } | { kind: 'stopped' };

export interface Router {
  /** Points the project's hostname at a target, or removes the route when null. Must leave the old route in place if it throws. */
  setRoute(projectName: string, target: RouteTarget | null): Promise<void>;
  /** Removes routes for projects that no longer exist. */
  prune(keepProjectNames: string[]): Promise<void>;
}

export type Release = () => Promise<void>;

export interface ProjectLocks {
  /** Returns a release function, or null when another runner holds the project. Never blocks. */
  acquire(projectId: string): Promise<Release | null>;
}

export interface EngineSettings {
  healthTimeoutMs: number;
  /** How many previous healthy releases keep their image, in addition to the active one. */
  retainedReleases: number;
  maxBuildLogLines: number;
}

export interface EngineDeps {
  store: Store;
  driver: ContainerDriver;
  router: Router;
  locks: ProjectLocks;
  encryptionKey: string;
  settings: EngineSettings;
}

/**
 * `locked` means another runner is working on the same project right now; the
 * caller should try again shortly without counting it as a failed attempt.
 */
export type RunResult = 'done' | 'skipped' | 'locked';

export class NoopRouter implements Router {
  async setRoute(): Promise<void> {}
  async prune(): Promise<void> {}
}
