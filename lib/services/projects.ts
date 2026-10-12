import type { BaseConfig } from '../config';
import { encryptValue, envAad } from '../crypto';
import {
  isBusy,
  toDeploymentDTO,
  toEnvVarDTO,
  toOperationDTO,
  toProjectDTO,
  type EnvVarDTO,
  type ProjectDTO,
  type ProjectDetailDTO,
  type ProjectSummaryDTO,
} from '../dto';
import { NotFoundError, ValidationError } from '../errors';
import type { Store } from '../store/types';
import type { Project } from '../types';
import {
  MAX_ENV_VARS,
  assertOwnerAllowed,
  createProjectSchema,
  envUpdateSchema,
  parseInput,
  parseRepoUrl,
  updateProjectSchema,
} from '../validation';

/** Everything a service call needs. `userId` always comes from a verified session. */
export interface ServiceContext {
  userId: string;
  store: Store;
  config: BaseConfig;
}

/**
 * The single authorization gate for project access: every service function
 * that touches a project goes through here. Someone else's project is reported
 * as missing rather than forbidden, so ids cannot be probed.
 */
export async function ownedProject(ctx: ServiceContext, projectId: string): Promise<Project> {
  const project = /^[a-f0-9]{24}$/.test(projectId) ? await ctx.store.getProject(projectId) : null;
  if (!project || project.ownerId !== ctx.userId) throw new NotFoundError('Project not found.');
  return project;
}

function canonicalRepoUrl(ctx: ServiceContext, input: string): string {
  const repo = parseRepoUrl(input);
  if (!repo) throw new ValidationError('Some fields need attention.', { repoUrl: 'Enter a public GitHub URL such as https://github.com/owner/repo.' });
  // Demo mode never clones anything, so there is nothing for the allowlist to protect.
  if (!ctx.config.demo) assertOwnerAllowed(repo, ctx.config.allowedOwners);
  return repo.url;
}

export async function listProjects(ctx: ServiceContext): Promise<ProjectSummaryDTO[]> {
  const projects = await ctx.store.listProjects(ctx.userId);
  return Promise.all(
    projects.map(async (project) => {
      const [deployments, operation] = await Promise.all([ctx.store.listDeployments(project.id, 1), ctx.store.latestOperation(project.id)]);
      return {
        ...toProjectDTO(project, ctx.config),
        latestDeployment: deployments[0] ? toDeploymentDTO(deployments[0], project) : null,
        busy: isBusy(project, deployments, operation),
      };
    }),
  );
}

export async function createProject(ctx: ServiceContext, input: unknown): Promise<ProjectDTO> {
  const data = parseInput(createProjectSchema, input);
  const project = await ctx.store.createProject({ ...data, repoUrl: canonicalRepoUrl(ctx, data.repoUrl), ownerId: ctx.userId });
  return toProjectDTO(project, ctx.config);
}

export async function getProjectDetail(ctx: ServiceContext, projectId: string): Promise<ProjectDetailDTO> {
  const project = await ownedProject(ctx, projectId);
  const [deployments, env, operation] = await Promise.all([
    ctx.store.listDeployments(project.id, 30),
    ctx.store.listEnv(project.id),
    ctx.store.latestOperation(project.id),
  ]);
  return {
    project: toProjectDTO(project, ctx.config),
    deployments: deployments.map((d) => toDeploymentDTO(d, project)),
    env: env.map(toEnvVarDTO),
    operation: operation ? toOperationDTO(operation) : null,
    busy: isBusy(project, deployments, operation),
  };
}

export async function updateProject(ctx: ServiceContext, projectId: string, input: unknown): Promise<ProjectDTO> {
  const project = await ownedProject(ctx, projectId);
  const patch = parseInput(updateProjectSchema, input);
  if (patch.repoUrl !== undefined) patch.repoUrl = canonicalRepoUrl(ctx, patch.repoUrl);
  return toProjectDTO(await ctx.store.updateProject(project.id, patch), ctx.config);
}

/** Values are write-only: they are encrypted here and no API ever returns them. */
export async function updateEnv(ctx: ServiceContext, projectId: string, input: unknown): Promise<EnvVarDTO[]> {
  const project = await ownedProject(ctx, projectId);
  const { set, remove } = parseInput(envUpdateSchema, input);
  const existing = await ctx.store.listEnv(project.id);
  const keys = new Set(existing.map((e) => e.key));
  for (const key of remove) keys.delete(key);
  for (const key of Object.keys(set)) keys.add(key);
  if (keys.size > MAX_ENV_VARS) throw new ValidationError(`A project can have at most ${MAX_ENV_VARS} environment variables.`);
  const sealed = Object.entries(set).map(([key, value]) => ({
    key,
    ciphertext: encryptValue(value, ctx.config.encryptionKey, envAad(project.id, key)),
  }));
  await ctx.store.applyEnv(project.id, sealed, remove.filter((key) => !(key in set)));
  return (await ctx.store.listEnv(project.id)).map(toEnvVarDTO);
}
