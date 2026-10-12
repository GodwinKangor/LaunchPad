import { projectUrl, type BaseConfig } from './config';
import {
  ACTIVE_OPERATION_STATUSES,
  isActiveState,
  type Deployment,
  type DeploymentKind,
  type DeploymentState,
  type EnvVar,
  type Operation,
  type OperationAction,
  type OperationStatus,
  type Project,
  type ProjectStatus,
} from './types';

/**
 * Shapes returned by the API. Built field by field (never by spreading rows)
 * so ciphertext, image tags and container names cannot leak by accident.
 */

export interface ProjectDTO {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  rootDirectory: string;
  port: number;
  healthPath: string;
  status: ProjectStatus;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentDTO {
  id: string;
  kind: DeploymentKind;
  state: DeploymentState;
  branch: string;
  commitSha: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** This release is the one currently receiving traffic. */
  isCurrent: boolean;
  canRollback: boolean;
  rollbackOfId: string | null;
}

export interface EnvVarDTO {
  key: string;
  updatedAt: string;
}

export interface OperationDTO {
  id: string;
  action: OperationAction;
  status: OperationStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ProjectSummaryDTO extends ProjectDTO {
  latestDeployment: DeploymentDTO | null;
  busy: boolean;
}

export interface ProjectDetailDTO {
  project: ProjectDTO;
  deployments: DeploymentDTO[];
  env: EnvVarDTO[];
  operation: OperationDTO | null;
  busy: boolean;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toProjectDTO(project: Project, config: BaseConfig): ProjectDTO {
  return {
    id: project.id,
    name: project.name,
    repoUrl: project.repoUrl,
    branch: project.branch,
    rootDirectory: project.rootDirectory,
    port: project.port,
    healthPath: project.healthPath,
    status: project.status,
    url: projectUrl(project.name, config),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toDeploymentDTO(deployment: Deployment, project: Project): DeploymentDTO {
  const isCurrent = project.activeDeploymentId === deployment.id;
  return {
    id: deployment.id,
    kind: deployment.kind,
    state: deployment.state,
    branch: deployment.branch,
    commitSha: deployment.commitSha,
    error: deployment.error,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: iso(deployment.startedAt),
    finishedAt: iso(deployment.finishedAt),
    isCurrent,
    canRollback: deployment.state === 'healthy' && deployment.imageRetained && !isCurrent,
    rollbackOfId: deployment.rollbackOfId,
  };
}

export function toEnvVarDTO(variable: EnvVar): EnvVarDTO {
  return { key: variable.key, updatedAt: variable.updatedAt.toISOString() };
}

export function toOperationDTO(operation: Operation): OperationDTO {
  return {
    id: operation.id,
    action: operation.action,
    status: operation.status,
    error: operation.error,
    createdAt: operation.createdAt.toISOString(),
    finishedAt: iso(operation.finishedAt),
  };
}

export function isBusy(project: Project, deployments: Deployment[], operation: Operation | null): boolean {
  return (
    project.status === 'deleting' ||
    deployments.some((d) => isActiveState(d.state)) ||
    (operation !== null && ACTIVE_OPERATION_STATUSES.includes(operation.status))
  );
}
