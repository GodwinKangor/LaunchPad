import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptValue, envAad } from '@/lib/crypto';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createProject, getProjectDetail, listProjects, updateEnv, updateProject } from '@/lib/services/projects';
import { SAMPLE_PROJECT, TEST_CONFIG, testContext } from './helpers';

test('creating a project canonicalises the repository and assigns a URL', async () => {
  const ctx = testContext();
  const project = await createProject(ctx, SAMPLE_PROJECT);
  assert.equal(project.repoUrl, 'https://github.com/me/blog.git');
  assert.equal(project.url, 'http://blog.localhost:8080');
  assert.equal(project.status, 'idle');
  const [summary] = await listProjects(ctx);
  assert.equal(summary.name, 'blog');
  assert.equal(summary.latestDeployment, null);
  assert.equal(summary.busy, false);
});

test('project creation enforces validation, the owner allowlist and unique names', async () => {
  const ctx = testContext();
  await assert.rejects(createProject(ctx, { ...SAMPLE_PROJECT, repoUrl: 'https://github.com/stranger/app' }), (err: unknown) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.fields?.repoUrl ?? '', /allowlist/);
    return true;
  });
  await assert.rejects(createProject(ctx, { ...SAMPLE_PROJECT, branch: '--upload-pack=x' }), ValidationError);
  await assert.rejects(createProject(ctx, { ...SAMPLE_PROJECT, port: 70000 }), ValidationError);
  await createProject(ctx, SAMPLE_PROJECT);
  await assert.rejects(createProject(ctx, SAMPLE_PROJECT), ConflictError);
});

test('a project is invisible to anyone but its owner', async () => {
  const ctx = testContext();
  const project = await createProject(ctx, SAMPLE_PROJECT);
  const intruder = { ...ctx, userId: 'someone-else' };

  assert.deepEqual(await listProjects(intruder), []);
  await assert.rejects(getProjectDetail(intruder, project.id), NotFoundError);
  await assert.rejects(updateProject(intruder, project.id, { branch: 'evil' }), NotFoundError);
  await assert.rejects(updateEnv(intruder, project.id, { set: { A: '1' } }), NotFoundError);
  await assert.rejects(getProjectDetail(ctx, 'not-an-id'), NotFoundError);
  await assert.rejects(getProjectDetail(ctx, 'a'.repeat(24)), NotFoundError);

  const detail = await getProjectDetail(ctx, project.id);
  assert.equal(detail.project.branch, 'main', 'intruder update had no effect');
  assert.deepEqual(detail.env, []);
});

test('settings can be changed but the name cannot', async () => {
  const ctx = testContext();
  const project = await createProject(ctx, SAMPLE_PROJECT);
  const updated = await updateProject(ctx, project.id, { branch: 'release', port: 8080, healthPath: '/healthz', name: 'renamed' });
  assert.equal(updated.branch, 'release');
  assert.equal(updated.port, 8080);
  assert.equal(updated.healthPath, '/healthz');
  assert.equal(updated.name, 'blog');
  await assert.rejects(updateProject(ctx, project.id, { repoUrl: 'https://github.com/stranger/app' }), ValidationError);
});

test('environment values are stored encrypted and never returned', async () => {
  const ctx = testContext();
  const project = await createProject(ctx, SAMPLE_PROJECT);
  const env = await updateEnv(ctx, project.id, { set: { API_KEY: 'sk-super-secret', MODE: 'production' } });
  assert.deepEqual(env.map((e) => e.key), ['API_KEY', 'MODE']);

  const stored = await ctx.store.listEnv(project.id);
  assert.ok(stored.every((row) => !row.ciphertext.includes('sk-super-secret')));
  assert.equal(decryptValue(stored[0].ciphertext, TEST_CONFIG.encryptionKey, envAad(project.id, 'API_KEY')), 'sk-super-secret');

  const everything = JSON.stringify([await getProjectDetail(ctx, project.id), await listProjects(ctx), env]);
  assert.ok(!everything.includes('sk-super-secret'));
  assert.ok(!everything.includes(stored[0].ciphertext), 'ciphertext is not exposed either');

  const after = await updateEnv(ctx, project.id, { set: { MODE: 'staging' }, remove: ['API_KEY'] });
  assert.deepEqual(after.map((e) => e.key), ['MODE']);
  await assert.rejects(updateEnv(ctx, project.id, { set: { PORT: '1' } }), ValidationError);
  await assert.rejects(updateEnv(ctx, project.id, { set: { 'BAD-KEY': '1' } }), ValidationError);
});
