import { Prisma, PrismaClient } from '@prisma/client';
import { BusyError, ConflictError, NotFoundError } from '../errors';
import { newId } from '../ids';
import {
  ACTIVE_OPERATION_STATUSES,
  ACTIVE_STATES,
  type Deployment,
  type DeploymentState,
  type EnvVar,
  type LogLine,
  type Operation,
  type OperationAction,
  type Project,
} from '../types';
import type { DeploymentPatch, NewDeployment, NewProject, OperationPatch, ProjectPatch, Store } from './types';

// State columns are plain strings in the schema; these casts are the single
// place where rows become the typed domain objects.
const toProject = (row: Prisma.ProjectGetPayload<object>): Project => row as Project;
const toDeployment = (row: Prisma.DeploymentGetPayload<object>): Deployment => row as Deployment;
const toOperation = (row: Prisma.OperationGetPayload<object>): Operation => row as Operation;

export class PrismaStore implements Store {
  constructor(private readonly db: PrismaClient) {}

  async createProject(input: NewProject): Promise<Project> {
    try {
      return toProject(await this.db.project.create({ data: { id: newId(), ...input } }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Some fields need attention.', { name: 'A project with this name already exists.' });
      }
      throw err;
    }
  }

  async getProject(id: string): Promise<Project | null> {
    const row = await this.db.project.findUnique({ where: { id } });
    return row ? toProject(row) : null;
  }

  async listProjects(ownerId?: string): Promise<Project[]> {
    const rows = await this.db.project.findMany({ where: ownerId === undefined ? {} : { ownerId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toProject);
  }

  async updateProject(id: string, patch: ProjectPatch): Promise<Project> {
    return toProject(await this.db.project.update({ where: { id }, data: patch }));
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.project.deleteMany({ where: { id } });
  }

  async listEnv(projectId: string): Promise<EnvVar[]> {
    return this.db.environmentVariable.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
      select: { key: true, ciphertext: true, updatedAt: true },
    });
  }

  async applyEnv(projectId: string, set: { key: string; ciphertext: string }[], remove: string[]): Promise<void> {
    await this.db.$transaction([
      this.db.environmentVariable.deleteMany({ where: { projectId, key: { in: remove } } }),
      ...set.map(({ key, ciphertext }) =>
        this.db.environmentVariable.upsert({
          where: { projectId_key: { projectId, key } },
          create: { id: newId(), projectId, key, ciphertext },
          update: { ciphertext },
        }),
      ),
    ]);
  }

  /** Locks the project row, then checks nothing is in flight. Concurrent callers queue on the row lock. */
  private async claim<T>(projectId: string, create: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Project not found.');
      const [deployments, operations] = await Promise.all([
        tx.deployment.count({ where: { projectId, state: { in: ACTIVE_STATES } } }),
        tx.operation.count({ where: { projectId, status: { in: ACTIVE_OPERATION_STATUSES } } }),
      ]);
      if (rows[0].status === 'deleting' || deployments + operations > 0) throw new BusyError();
      return create(tx);
    });
  }

  async beginDeployment(projectId: string, input: NewDeployment): Promise<Deployment> {
    return this.claim(projectId, async (tx) =>
      toDeployment(
        await tx.deployment.create({
          data: {
            id: newId(),
            projectId,
            kind: input.kind,
            branch: input.branch,
            commitSha: input.commitSha ?? null,
            image: input.image ?? null,
            rollbackOfId: input.rollbackOfId ?? null,
          },
        }),
      ),
    );
  }

  async beginOperation(projectId: string, action: OperationAction): Promise<Operation> {
    return this.claim(projectId, async (tx) => {
      const operation = await tx.operation.create({ data: { id: newId(), projectId, action } });
      if (action === 'delete') await tx.project.update({ where: { id: projectId }, data: { status: 'deleting' } });
      return toOperation(operation);
    });
  }

  async getDeployment(id: string): Promise<Deployment | null> {
    const row = await this.db.deployment.findUnique({ where: { id } });
    return row ? toDeployment(row) : null;
  }

  async listDeployments(projectId: string, limit = 50): Promise<Deployment[]> {
    const rows = await this.db.deployment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toDeployment);
  }

  async transitionDeployment(id: string, from: DeploymentState[], to: DeploymentState, patch: DeploymentPatch = {}): Promise<Deployment | null> {
    const result = await this.db.deployment.updateMany({ where: { id, state: { in: from } }, data: { ...patch, state: to } });
    return result.count === 0 ? null : this.getDeployment(id);
  }

  async updateDeployment(id: string, patch: DeploymentPatch): Promise<void> {
    await this.db.deployment.updateMany({ where: { id }, data: patch });
  }

  async promoteDeployment(id: string, patch: DeploymentPatch): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const deployment = await tx.deployment.findUnique({ where: { id }, select: { projectId: true } });
      if (!deployment) return false;
      const updated = await tx.deployment.updateMany({ where: { id, state: 'starting' }, data: { ...patch, state: 'healthy' } });
      if (updated.count === 0) return false;
      await tx.project.update({ where: { id: deployment.projectId }, data: { activeDeploymentId: id, status: 'running' } });
      return true;
    });
  }

  async listActiveDeployments(): Promise<Deployment[]> {
    const rows = await this.db.deployment.findMany({ where: { state: { in: ACTIVE_STATES } } });
    return rows.map(toDeployment);
  }

  async appendLogs(deploymentId: string, messages: string[]): Promise<void> {
    if (messages.length === 0) return;
    try {
      await this.db.deploymentLog.createMany({ data: messages.map((message) => ({ deploymentId, message })) });
    } catch (err) {
      // The project (and its deployments) can be deleted while late log lines are still flushing.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') return;
      throw err;
    }
  }

  async getLogs(deploymentId: string, afterId: number, limit: number): Promise<LogLine[]> {
    return this.db.deploymentLog.findMany({ where: { deploymentId, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit });
  }

  async getOperation(id: string): Promise<Operation | null> {
    const row = await this.db.operation.findUnique({ where: { id } });
    return row ? toOperation(row) : null;
  }

  async latestOperation(projectId: string): Promise<Operation | null> {
    const row = await this.db.operation.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return row ? toOperation(row) : null;
  }

  async updateOperation(id: string, patch: OperationPatch): Promise<void> {
    await this.db.operation.updateMany({ where: { id }, data: patch });
  }

  async listActiveOperations(): Promise<Operation[]> {
    const rows = await this.db.operation.findMany({ where: { status: { in: ACTIVE_OPERATION_STATUSES } } });
    return rows.map(toOperation);
  }
}

export function createPrismaStore(databaseUrl: string): { store: PrismaStore; client: PrismaClient } {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['warn', 'error'] });
  return { store: new PrismaStore(client), client };
}
