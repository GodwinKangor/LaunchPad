import { z } from 'zod';
import { ValidationError } from './errors';

/**
 * Everything a user types that later reaches git, Docker or Caddy is validated
 * here against a strict allowlist. Subprocesses still receive these values as
 * argument-array entries, never through a shell.
 */

const RESERVED_NAMES = new Set(['www', 'api', 'app', 'admin', 'dashboard', 'launchpad', 'caddy', 'localhost']);

export const projectNameSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters.')
  .max(40, 'Use at most 40 characters.')
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'Use lowercase letters, numbers and hyphens, starting with a letter.')
  .refine((v) => !v.includes('--'), 'Do not use consecutive hyphens.')
  .refine((v) => !RESERVED_NAMES.has(v), 'This name is reserved.');

export interface RepoRef {
  owner: string;
  repo: string;
  /** Canonical clone URL; the only form ever handed to git. */
  url: string;
}

export function parseRepoUrl(input: string): RepoRef | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/?$/.exec(input.trim());
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..') return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}.git` };
}

export const repoUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => parseRepoUrl(v) !== null, 'Enter a public GitHub URL such as https://github.com/owner/repo.');

export const branchSchema = z
  .string()
  .trim()
  .min(1, 'Enter a branch.')
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Branch names may contain letters, numbers, ".", "_", "-" and "/".')
  .refine((v) => !v.includes('..') && !v.includes('//') && !v.endsWith('/') && !v.endsWith('.') && !v.endsWith('.lock'), 'This is not a valid branch name.');

export const portSchema = z.coerce
  .number({ invalid_type_error: 'Enter a port number.' })
  .int('Enter a whole number.')
  .min(1, 'Ports start at 1.')
  .max(65535, 'Ports end at 65535.');

export const rootDirectorySchema = z
  .string()
  .trim()
  .max(200)
  .transform((v) => v.replace(/^\/+|\/+$/g, ''))
  .refine((v) => v === '' || v.split('/').every((s) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(s)), 'Use a relative folder path such as "apps/web".');

export const healthPathSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[A-Za-z0-9._~/-]*$/, 'Use a path that starts with "/", such as /healthz.')
  .refine((v) => !v.includes('..') && !v.includes('//'), 'This is not a valid path.');

export const envKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'Keys use letters, numbers and underscores, and cannot start with a number.')
  .refine((v) => v !== 'PORT', 'PORT is set by LaunchPad from the project port.')
  .refine((v) => !v.startsWith('LAUNCHPAD_'), 'The LAUNCHPAD_ prefix is reserved.');

export const envValueSchema = z
  .string()
  .max(16_384, 'Values are limited to 16 KB.')
  .refine((v) => !v.includes('\0'), 'Values cannot contain NUL bytes.');

export const MAX_ENV_VARS = 100;

export const createProjectSchema = z.object({
  name: projectNameSchema,
  repoUrl: repoUrlSchema,
  branch: branchSchema,
  port: portSchema,
  rootDirectory: rootDirectorySchema.default(''),
  healthPath: healthPathSchema.default('/'),
});

export const updateProjectSchema = z
  .object({
    repoUrl: repoUrlSchema,
    branch: branchSchema,
    port: portSchema,
    rootDirectory: rootDirectorySchema,
    healthPath: healthPathSchema,
  })
  .partial();

export const envUpdateSchema = z.object({
  set: z.record(envKeySchema, envValueSchema).default({}),
  remove: z.array(envKeySchema).max(MAX_ENV_VARS).default([]),
});

/** Parse with zod and convert failures into a field-keyed error the UI can render inline. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new ValidationError('Some fields need attention.', fields);
}

export function assertOwnerAllowed(repo: RepoRef, allowedOwners: string[]): void {
  if (!allowedOwners.includes(repo.owner.toLowerCase())) {
    throw new ValidationError('Some fields need attention.', {
      repoUrl: `Repositories owned by "${repo.owner}" are not on this server's allowlist (GITHUB_ALLOWED_OWNERS).`,
    });
  }
}
