import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canTransition } from '@/lib/types';
import { loadAuthConfig, loadBaseConfig, projectUrl } from '@/lib/config';
import { ValidationError } from '@/lib/errors';
import {
  assertOwnerAllowed,
  branchSchema,
  createProjectSchema,
  envKeySchema,
  healthPathSchema,
  parseInput,
  parseRepoUrl,
  portSchema,
  projectNameSchema,
  rootDirectorySchema,
} from '@/lib/validation';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

test('project names are DNS-label safe', () => {
  for (const good of ['blog', 'my-app', 'a1', 'api-v2']) assert.ok(ok(projectNameSchema, good), good);
  for (const bad of ['', 'a', 'My-App', '-app', 'app-', 'a--b', '1app', 'a_b', 'a.b', 'www', 'x'.repeat(41), 'app;rm', 'app name']) {
    assert.ok(!ok(projectNameSchema, bad), bad);
  }
});

test('repository URLs must be plain https GitHub URLs and are canonicalised', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/octocat/Hello-World'), {
    owner: 'octocat',
    repo: 'Hello-World',
    url: 'https://github.com/octocat/Hello-World.git',
  });
  assert.equal(parseRepoUrl('https://github.com/octocat/hello.git/')?.url, 'https://github.com/octocat/hello.git');
  for (const bad of [
    'http://github.com/a/b',
    'git@github.com:a/b.git',
    'https://github.com/a',
    'https://github.com/a/b/tree/main',
    'https://gitlab.com/a/b',
    'https://github.com.evil.io/a/b',
    'https://user:pass@github.com/a/b',
    'https://github.com/a/b?x=1',
    'https://github.com/a/..',
    'https://github.com/-a/b',
    'file:///etc/passwd',
    '--upload-pack=touch /tmp/x',
    'https://github.com/a/b c',
  ]) {
    assert.equal(parseRepoUrl(bad), null, bad);
  }
});

test('branches cannot smuggle options or path traversal', () => {
  for (const good of ['main', 'release/1.2', 'feature/add_x', 'v1.0.0']) assert.ok(ok(branchSchema, good), good);
  for (const bad of ['', '-b', '--upload-pack=x', 'a..b', 'a b', 'a;b', 'a$(x)', 'a/', 'a//b', 'x.lock', 'a~1', 'a:b', '@{u}']) {
    assert.ok(!ok(branchSchema, bad), bad);
  }
});

test('ports, folders and health paths are bounded', () => {
  assert.equal(portSchema.parse('3000'), 3000);
  for (const bad of [0, 65536, 1.5, 'abc', -1]) assert.ok(!ok(portSchema, bad), String(bad));
  assert.equal(rootDirectorySchema.parse('/apps/web/'), 'apps/web');
  assert.equal(rootDirectorySchema.parse(''), '');
  for (const bad of ['../x', 'a/../b', '.git', 'a b', 'a/./b']) assert.ok(!ok(rootDirectorySchema, bad), bad);
  for (const good of ['/', '/healthz', '/api/v1/ping']) assert.ok(ok(healthPathSchema, good), good);
  for (const bad of ['healthz', '/a/../b', '/a?b=1', '//evil.example', '/a b']) assert.ok(!ok(healthPathSchema, bad), bad);
});

test('environment keys reject reserved and malformed names', () => {
  for (const good of ['DATABASE_URL', '_x', 'a1']) assert.ok(ok(envKeySchema, good), good);
  for (const bad of ['1A', 'A-B', 'A B', 'PORT', 'LAUNCHPAD_X', 'A=B', '']) assert.ok(!ok(envKeySchema, bad), bad);
});

test('parseInput reports errors per field', () => {
  assert.throws(
    () => parseInput(createProjectSchema, { name: 'Bad Name', repoUrl: 'nope', branch: 'main', port: 99999 }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.deepEqual(Object.keys(err.fields ?? {}).sort(), ['name', 'port', 'repoUrl']);
      return true;
    },
  );
  const parsed = parseInput(createProjectSchema, { name: 'blog', repoUrl: 'https://github.com/me/blog', branch: 'main', port: '8080' });
  assert.deepEqual(parsed, { name: 'blog', repoUrl: 'https://github.com/me/blog', branch: 'main', port: 8080, rootDirectory: '', healthPath: '/' });
});

test('repository owners must be on the allowlist', () => {
  const repo = parseRepoUrl('https://github.com/Me/blog')!;
  assert.doesNotThrow(() => assertOwnerAllowed(repo, ['me']));
  assert.throws(() => assertOwnerAllowed(repo, ['someone-else']), ValidationError);
  assert.throws(() => assertOwnerAllowed(repo, []), ValidationError);
});

test('deployment transitions only move forward, or back to queued for a retry', () => {
  assert.ok(canTransition('queued', 'cloning'));
  assert.ok(canTransition('cloning', 'building'));
  assert.ok(canTransition('building', 'starting'));
  assert.ok(canTransition('starting', 'healthy'));
  assert.ok(canTransition('queued', 'starting'), 'rollbacks skip clone and build');
  assert.ok(canTransition('building', 'queued'), 'retry');
  assert.ok(!canTransition('queued', 'healthy'));
  assert.ok(!canTransition('cloning', 'starting'));
  assert.ok(!canTransition('healthy', 'failed'));
  assert.ok(!canTransition('failed', 'queued'));
});

test('real mode refuses placeholder secrets; demo mode needs no configuration', () => {
  const real = {
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    GITHUB_ALLOWED_OWNERS: 'me, Other',
    ENV_ENCRYPTION_KEY: 'ab'.repeat(32),
  };
  const config = loadBaseConfig(real);
  assert.equal(config.demo, false);
  assert.deepEqual(config.allowedOwners, ['me', 'other']);
  assert.throws(() => loadBaseConfig({ ...real, ENV_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4) }), /example value/);
  assert.throws(() => loadBaseConfig({ ...real, ENV_ENCRYPTION_KEY: 'short' }), /64 hex/);
  assert.throws(() => loadBaseConfig({ ...real, GITHUB_ALLOWED_OWNERS: 'your-github-username' }), /GITHUB_ALLOWED_OWNERS/);
  assert.throws(() => loadAuthConfig({ OWNER_EMAIL: 'a@b.c', OWNER_PASSWORD: 'change-this-owner-password', SESSION_SECRET: 'x'.repeat(40) }), /OWNER_PASSWORD/);
  assert.throws(() => loadAuthConfig({ OWNER_EMAIL: 'a@b.c', OWNER_PASSWORD: 'a-long-password', SESSION_SECRET: 'replace-with-at-least-32-random-characters' }), /SESSION_SECRET/);
  assert.equal(loadBaseConfig({ DEMO_MODE: 'true' }).demo, true);
  assert.equal(loadAuthConfig({ DEMO_MODE: 'true' }).ownerEmail, 'owner@launchpad.local');
});

test('project URLs follow the configured domain', () => {
  const base = { demo: false, appDomain: 'localhost', appScheme: 'http' as const, appPublicPort: 8080 };
  assert.equal(projectUrl('blog', base), 'http://blog.localhost:8080');
  assert.equal(projectUrl('blog', { ...base, appDomain: 'apps.example.com', appScheme: 'https', appPublicPort: null }), 'https://blog.apps.example.com');
  assert.equal(projectUrl('blog', { ...base, demo: true }), '/demo-app/blog');
});
