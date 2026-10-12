import type {
  Deployment,
  DeploymentKind,
  DeploymentState,
  EnvVar,
  LogLine,
  Operation,
  OperationAction,
  OperationStatus,
  Project,
  ProjectStatus,
} from '../types';

export interface NewProject {
  ownerId: string;
  name: string;
  repoUrl: string;
  branch: string;
  rootDirectory: string;
  port: number;
  healthPath: string;
}

export interface ProjectPatch {
  repoUrl?: string;
  branch?: string;
  rootDirectory?: string;
  port?: number;
  healthPath?: string;
  status?: ProjectStatus;
  activeDeploymentId?: string | null;
}

export interface NewDeployment {
  kind: DeploymentKind;
  branch: string;
  commitSha?: string | null;
  image?: string | null;
  rollbackOfId?: string | null;
}

export interface DeploymentPatch {
  commitSha?: string | null;
  image?: string | null;
  imageRetained?: boolean;
  containerName?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export interface OperationPatch {
  status?: OperationStatus;
  error?: string | null;
  finishedAt?: Date | null;
}

/**
 * Persistence boundary. Two implementations exist: Prisma/PostgreSQL for real
 * deployments and an in-memory store for demo mode and tests.
 */
export interface Store {
  /** Throws ConflictError when the name is taken. */
  createProject(input: NewProject): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(ownerId?: string): Promise<Project[]>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  listEnv(projectId: string): Promise<EnvVar[]>;
  applyEnv(projectId: string, set: { key: string; ciphertext: string }[], remove: string[]): Promise<void>;

  /**
   * Atomically claims the project's single work slot. Throws BusyError when a
   * deployment or operation is already in flight, which is what stops two
   * concurrent requests from both starting work.
   */
  beginDeployment(projectId: string, input: NewDeployment): Promise<Deployment>;
  beginOperation(projectId: string, action: OperationAction): Promise<Operation>;

  getDeployment(id: string): Promise<Deployment | null>;
  /** Newest first. */
  listDeployments(projectId: string, limit?: number): Promise<Deployment[]>;
  /** Compare-and-set on state. Returns null when the deployment was not in one of `from`. */
  transitionDeployment(id: string, from: DeploymentState[], to: DeploymentState, patch?: DeploymentPatch): Promise<Deployment | null>;
  updateDeployment(id: string, patch: DeploymentPatch): Promise<void>;
  listActiveDeployments(): Promise<Deployment[]>;

  appendLogs(deploymentId: string, messages: string[]): Promise<void>;
  getLogs(deploymentId: string, afterId: number, limit: number): Promise<LogLine[]>;

  getOperation(id: string): Promise<Operation | null>;
  latestOperation(projectId: string): Promise<Operation | null>;
  updateOperation(id: string, patch: OperationPatch): Promise<void>;
  listActiveOperations(): Promise<Operation[]>;
}
