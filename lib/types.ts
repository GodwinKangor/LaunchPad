export const DEPLOYMENT_STATES = ['queued', 'cloning', 'building', 'starting', 'healthy', 'failed'] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

/** States in which a deployment still owns the project's deploy slot. */
export const ACTIVE_STATES: DeploymentState[] = ['queued', 'cloning', 'building', 'starting'];

export function isActiveState(state: DeploymentState): boolean {
  return ACTIVE_STATES.includes(state);
}

/**
 * Legal forward transitions. Returning to `queued` is the one backwards edge:
 * it is how a retried job restarts an attempt that was interrupted mid-flight.
 */
const TRANSITIONS: Record<DeploymentState, DeploymentState[]> = {
  queued: ['cloning', 'starting', 'failed'],
  cloning: ['building', 'failed', 'queued'],
  building: ['starting', 'failed', 'queued'],
  starting: ['healthy', 'failed', 'queued'],
  healthy: [],
  failed: [],
};

export function canTransition(from: DeploymentState, to: DeploymentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export type DeploymentKind = 'deploy' | 'rollback';
export type ProjectStatus = 'idle' | 'running' | 'stopped' | 'crashed' | 'deleting';
export type OperationAction = 'restart' | 'start' | 'stop' | 'delete';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export const ACTIVE_OPERATION_STATUSES: OperationStatus[] = ['queued', 'running'];

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  repoUrl: string;
  branch: string;
  rootDirectory: string;
  port: number;
  healthPath: string;
  status: ProjectStatus;
  activeDeploymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Deployment {
  id: string;
  projectId: string;
  kind: DeploymentKind;
  state: DeploymentState;
  branch: string;
  commitSha: string | null;
  image: string | null;
  /** True while the image is still present on the host and can be rolled back to. */
  imageRetained: boolean;
  containerName: string | null;
  rollbackOfId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface LogLine {
  id: number;
  deploymentId: string;
  message: string;
  createdAt: Date;
}

export interface EnvVar {
  key: string;
  ciphertext: string;
  updatedAt: Date;
}

export interface Operation {
  id: string;
  projectId: string;
  action: OperationAction;
  status: OperationStatus;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}
