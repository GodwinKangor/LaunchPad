import { BusyError, ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import {
  ACTIVE_OPERATION_STATUSES,
  isActiveState,
  type Deployment,
  type DeploymentState,
  type EnvVar,
  type LogLine,
  type Operation,
  type OperationAction,
  type Project,
} from '../types';
import type { DeploymentPatch, NewDeployment, NewProject, OperationPatch, ProjectPatch, Store } from './types';

export interface MemorySnapshot {
  projects: Project[];
  deployments: Deployment[];
  logs: LogLine[];
  env: (EnvVar & { projectId: string })[];
  operations: Operation[];
  logSeq: number;
}

const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'startedAt', 'finishedAt']);

export function reviveSnapshot(json: string): MemorySnapshot {
  return JSON.parse(json, (key, value) => (DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value)) as MemorySnapshot;
}

/**
 * In-memory Store used by demo mode and by tests. Single-threaded JavaScript
 * makes each method atomic, which is all the "transaction" this needs.
 */
export class MemoryStore implements Store {
  private data: MemorySnapshot = { projects: [], deployments: [], logs: [], env: [], operations: [], logSeq: 0 };
  /** Wall clock that never repeats, so "newest first" is stable for rows created in the same millisecond. */
  private lastTick = 0;

  constructor(
    snapshot?: MemorySnapshot,
    private readonly onChange?: (snapshot: MemorySnapshot) => void,
  ) {
    if (snapshot) this.data = snapshot;
  }

  private now(): Date {
    this.lastTick = Math.max(Date.now(), this.lastTick + 1);
    return new Date(this.lastTick);
  }

  private changed() {
    this.onChange?.(this.data);
  }

  private project(id: string): Project {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) throw new NotFoundError('Project not found.');
    return project;
  }

  private assertFree(projectId: string) {
    const project = this.project(projectId);
    const busy =
      project.status === 'deleting' ||
      this.data.deployments.some((d) => d.projectId === projectId && isActiveState(d.state)) ||
      this.data.operations.some((o) => o.projectId === projectId && ACTIVE_OPERATION_STATUSES.includes(o.status));
    if (busy) throw new BusyError();
  }

  async createProject(input: NewProject): Promise<Project> {
    if (this.data.projects.some((p) => p.name === input.name)) {
      throw new ConflictError('Some fields need attention.', { name: 'A project with this name already exists.' });
    }
    const now = this.now();
    const project: Project = { id: newId(), ...input, status: 'idle', activeDeploymentId: null, createdAt: now, updatedAt: now };
    this.data.projects.push(project);
    this.changed();
    return { ...project };
  }

  async getProject(id: string): Promise<Project | null> {
    const project = this.data.projects.find((p) => p.id === id);
    return project ? { ...project } : null;
  }

  async listProjects(ownerId?: string): Promise<Project[]> {
    return this.data.projects
      .filter((p) => ownerId === undefined || p.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({ ...p }));
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<Project> {
    const project = this.project(id);
    Object.assign(project, patch, { updatedAt: this.now() });
    this.changed();
    return { ...project };
  }

  async deleteProject(id: string): Promise<void> {
    const deploymentIds = new Set(this.data.deployments.filter((d) => d.projectId === id).map((d) => d.id));
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.data.deployments = this.data.deployments.filter((d) => d.projectId !== id);
    this.data.logs = this.data.logs.filter((l) => !deploymentIds.has(l.deploymentId));
    this.data.env = this.data.env.filter((e) => e.projectId !== id);
    this.data.operations = this.data.operations.filter((o) => o.projectId !== id);
    this.changed();
  }

  async listEnv(projectId: string): Promise<EnvVar[]> {
    return this.data.env
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ key, ciphertext, updatedAt }) => ({ key, ciphertext, updatedAt }));
  }

  async applyEnv(projectId: string, set: { key: string; ciphertext: string }[], remove: string[]): Promise<void> {
    this.project(projectId);
    const drop = new Set([...remove, ...set.map((s) => s.key)]);
    this.data.env = this.data.env.filter((e) => e.projectId !== projectId || !drop.has(e.key));
    const now = this.now();
    for (const { key, ciphertext } of set) this.data.env.push({ projectId, key, ciphertext, updatedAt: now });
    this.changed();
  }

  async beginDeployment(projectId: string, input: NewDeployment): Promise<Deployment> {
    this.assertFree(projectId);
    const deployment: Deployment = {
      id: newId(),
      projectId,
      kind: input.kind,
      state: 'queued',
      branch: input.branch,
      commitSha: input.commitSha ?? null,
      image: input.image ?? null,
      imageRetained: false,
      containerName: null,
      rollbackOfId: input.rollbackOfId ?? null,
      error: null,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.data.deployments.push(deployment);
    this.changed();
    return { ...deployment };
  }

  async beginOperation(projectId: string, action: OperationAction): Promise<Operation> {
    this.assertFree(projectId);
    const operation: Operation = { id: newId(), projectId, action, status: 'queued', error: null, createdAt: this.now(), finishedAt: null };
    this.data.operations.push(operation);
    if (action === 'delete') this.project(projectId).status = 'deleting';
    this.changed();
    return { ...operation };
  }

  async getDeployment(id: string): Promise<Deployment | null> {
    const deployment = this.data.deployments.find((d) => d.id === id);
    return deployment ? { ...deployment } : null;
  }

  async listDeployments(projectId: string, limit = 50): Promise<Deployment[]> {
    return this.data.deployments
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async transitionDeployment(id: string, from: DeploymentState[], to: DeploymentState, patch: DeploymentPatch = {}): Promise<Deployment | null> {
    const deployment = this.data.deployments.find((d) => d.id === id);
    if (!deployment || !from.includes(deployment.state)) return null;
    Object.assign(deployment, patch, { state: to });
    this.changed();
    return { ...deployment };
  }

  async updateDeployment(id: string, patch: DeploymentPatch): Promise<void> {
    const deployment = this.data.deployments.find((d) => d.id === id);
    if (!deployment) return;
    Object.assign(deployment, patch);
    this.changed();
  }

  async promoteDeployment(id: string, patch: DeploymentPatch): Promise<boolean> {
    const deployment = this.data.deployments.find((d) => d.id === id);
    const project = deployment && this.data.projects.find((p) => p.id === deployment.projectId);
    if (!deployment || !project || deployment.state !== 'starting') return false;
    Object.assign(deployment, patch, { state: 'healthy' });
    Object.assign(project, { activeDeploymentId: id, status: 'running', updatedAt: this.now() });
    this.changed();
    return true;
  }

  async listActiveDeployments(): Promise<Deployment[]> {
    return this.data.deployments.filter((d) => isActiveState(d.state)).map((d) => ({ ...d }));
  }

  async appendLogs(deploymentId: string, messages: string[]): Promise<void> {
    if (!this.data.deployments.some((d) => d.id === deploymentId)) return;
    const createdAt = new Date();
    for (const message of messages) this.data.logs.push({ id: ++this.data.logSeq, deploymentId, message, createdAt });
    this.changed();
  }

  async getLogs(deploymentId: string, afterId: number, limit: number): Promise<LogLine[]> {
    return this.data.logs.filter((l) => l.deploymentId === deploymentId && l.id > afterId).slice(0, limit);
  }

  async getOperation(id: string): Promise<Operation | null> {
    const operation = this.data.operations.find((o) => o.id === id);
    return operation ? { ...operation } : null;
  }

  async latestOperation(projectId: string): Promise<Operation | null> {
    const operations = this.data.operations.filter((o) => o.projectId === projectId);
    const latest = operations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return latest ? { ...latest } : null;
  }

  async updateOperation(id: string, patch: OperationPatch): Promise<void> {
    const operation = this.data.operations.find((o) => o.id === id);
    if (!operation) return;
    Object.assign(operation, patch);
    this.changed();
  }

  async listActiveOperations(): Promise<Operation[]> {
    return this.data.operations.filter((o) => ACTIVE_OPERATION_STATUSES.includes(o.status)).map((o) => ({ ...o }));
  }
}
