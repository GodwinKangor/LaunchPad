import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDeployment } from '@/lib/engine/deploy';
import { DeployError } from '@/lib/engine/types';
import { BusyError, UnavailableError } from '@/lib/errors';
import { createProject, deployProject, getProjectDetail } from '@/lib/services/projects';
import { harness, type Harness } from './fakes';
import { RecordingDispatcher, SAMPLE_PROJECT, testContext } from './helpers';

async function deploy(h: Harness, projectId: string) {
  const deployment = await h.store.beginDeployment(projectId, { kind: 'deploy', branch: 'main' });
  const result = await runDeployment(h.deps, deployment.id);
  return { id: deployment.id, result, deployment: (await h.store.getDeployment(deployment.id))! };
}

test('a deployment moves queued → cloning → building → starting → healthy and takes traffic', async () => {
  const h = harness();
  const project = await h.project();
  const { id, result, deployment } = await deploy(h, project.id);

  assert.equal(result, 'done');
  assert.deepEqual(h.transitions.get(id), ['cloning', 'building', 'starting', 'healthy']);
  assert.deepEqual(h.driver.calls, ['checkout', 'build', 'run', 'health']);
  assert.equal(deployment.state, 'healthy');
  assert.match(deployment.commitSha ?? '', /^[0-9a-f]{40}$/);
  assert.equal(deployment.image, `launchpad/blog:${id}`);
  assert.equal(deployment.imageRetained, true);
  assert.ok(deployment.startedAt && deployment.finishedAt);

  const after = (await h.store.getProject(project.id))!;
  assert.equal(after.status, 'running');
  assert.equal(after.activeDeploymentId, id);
  assert.deepEqual(h.driver.running(project.id), [deployment.containerName]);
  assert.deepEqual(h.router.routes.get('blog'), { kind: 'upstream', container: deployment.containerName, port: 3000 });
  assert.deepEqual(h.driver.promoted, [deployment.containerName], 'restart policy enabled only after the health check');
  assert.equal(h.driver.workspaces.size, 0, 'build directory removed');
  assert.match(await h.logText(id), /Checked out commit[\s\S]*Build finished[\s\S]*Deployment is live/);
});

test('a failed build leaves the previous release serving and cleans up', async () => {
  const h = harness();
  const project = await h.project();
  const first = await deploy(h, project.id);

  h.driver.buildError = new DeployError('The Docker build failed. See the build log for the failing step.');
  const second = await deploy(h, project.id);

  assert.deepEqual(h.transitions.get(second.id), ['cloning', 'building', 'failed']);
  assert.equal(second.deployment.state, 'failed');
  assert.match(second.deployment.error ?? '', /Docker build failed/);
  assert.ok(second.deployment.finishedAt);
  assert.equal(second.deployment.imageRetained, false);

  const after = (await h.store.getProject(project.id))!;
  assert.equal(after.status, 'running');
  assert.equal(after.activeDeploymentId, first.id);
  assert.deepEqual(h.driver.running(project.id), [first.deployment.containerName]);
  assert.equal(h.router.upstream('blog'), first.deployment.containerName);
  assert.ok(!h.driver.images.has(`launchpad/blog:${second.id}`));
  assert.equal(h.driver.workspaces.size, 0);
  assert.match(await h.logText(second.id), /previous release is still serving traffic/);
});

test('an unexpected failure while starting removes the half-created container', async () => {
  const h = harness();
  const project = await h.project();
  h.driver.runError = new Error('Docker refused to create the container (HTTP 500)');
  const { deployment } = await deploy(h, project.id);

  assert.equal(deployment.state, 'failed');
  assert.match(deployment.error ?? '', /^Unexpected error: Docker refused/);
  assert.equal(h.driver.containers.size, 0);
  assert.equal(h.driver.images.size, 0, 'the image of a failed deployment is not kept');
  assert.equal(h.router.routes.size, 0);
  assert.equal((await h.store.getProject(project.id))!.status, 'idle');
});

test('duplicate jobs for one deployment run it exactly once', async () => {
  const h = harness();
  const project = await h.project();
  const deployment = await h.store.beginDeployment(project.id, { kind: 'deploy', branch: 'main' });

  const results = await Promise.all([runDeployment(h.deps, deployment.id), runDeployment(h.deps, deployment.id), runDeployment(h.deps, deployment.id)]);
  assert.deepEqual(results.sort(), ['done', 'locked', 'locked']);
  // The queue redelivers the locked jobs later; by then the work is finished.
  assert.equal(await runDeployment(h.deps, deployment.id), 'skipped');
  assert.equal(await runDeployment(h.deps, 'f'.repeat(24)), 'skipped', 'unknown deployment');

  assert.equal(h.driver.calls.filter((c) => c === 'checkout').length, 1);
  assert.equal(h.driver.calls.filter((c) => c === 'run').length, 1);
  assert.equal(h.driver.running(project.id).length, 1);
  assert.deepEqual(h.transitions.get(deployment.id), ['cloning', 'building', 'starting', 'healthy']);
});

test('a second deploy request is refused while one is in flight', async () => {
  const dispatcher = new RecordingDispatcher();
  const ctx = testContext({ dispatcher });
  const project = await createProject(ctx, SAMPLE_PROJECT);

  const [a, b] = await Promise.allSettled([deployProject(ctx, project.id), deployProject(ctx, project.id)]);
  assert.equal(a.status, 'fulfilled');
  assert.ok(b.status === 'rejected' && b.reason instanceof BusyError);
  await assert.rejects(deployProject(ctx, project.id), BusyError);
  assert.equal(dispatcher.jobs.length, 1);
  assert.equal((await getProjectDetail(ctx, project.id)).deployments.length, 1);
  assert.equal((await getProjectDetail(ctx, project.id)).busy, true);
});

test('if the job cannot be queued the deployment fails and the project is not left busy', async () => {
  const dispatcher = new RecordingDispatcher();
  const ctx = testContext({ dispatcher });
  const project = await createProject(ctx, SAMPLE_PROJECT);
  dispatcher.failWith = new UnavailableError('The job queue is not reachable.');
  await assert.rejects(deployProject(ctx, project.id), UnavailableError);

  const detail = await getProjectDetail(ctx, project.id);
  assert.equal(detail.deployments[0].state, 'failed');
  assert.equal(detail.busy, false);
  dispatcher.failWith = null;
  await assert.doesNotReject(deployProject(ctx, project.id));
});

test('a retried job cleans up an interrupted attempt and never leaves two containers', async () => {
  const h = harness();
  const project = await h.project();
  const first = await deploy(h, project.id);

  // Simulate a worker that died while starting the second release: state is mid-flight,
  // a half-started container and a build directory are left behind.
  const second = await h.store.beginDeployment(project.id, { kind: 'deploy', branch: 'main' });
  await h.store.transitionDeployment(second.id, ['queued'], 'starting');
  h.driver.containers.set('lp-blog-stale', { name: 'lp-blog-stale', projectId: project.id, deploymentId: second.id, running: true });
  h.driver.workspaces.add(second.id);
  h.transitions.delete(second.id);

  assert.equal(await runDeployment(h.deps, second.id), 'done');

  assert.deepEqual(h.transitions.get(second.id), ['queued', 'cloning', 'building', 'starting', 'healthy']);
  const done = (await h.store.getDeployment(second.id))!;
  assert.deepEqual(h.driver.running(project.id), [done.containerName], 'stale and previous containers are both gone');
  assert.ok(!h.driver.containers.has('lp-blog-stale'));
  assert.ok(!h.driver.containers.has(first.deployment.containerName!));
  assert.equal(h.router.upstream('blog'), done.containerName);
  assert.match(await h.logText(second.id), /Resuming after an interrupted attempt \(was starting\)/);
});

test('if recording the failure fails, the job errors so the queue retries it', async () => {
  const h = harness();
  const project = await h.project();
  const deployment = await h.store.beginDeployment(project.id, { kind: 'deploy', branch: 'main' });
  h.driver.buildError = new DeployError('The Docker build failed.');
  const transition = h.store.transitionDeployment;
  h.store.transitionDeployment = async (id, from, to, patch) => {
    if (to === 'failed') throw new Error('database unavailable');
    return transition(id, from, to, patch);
  };

  await assert.rejects(runDeployment(h.deps, deployment.id), /database unavailable/);
  assert.equal((await h.store.getDeployment(deployment.id))!.state, 'building', 'still in flight, so the retry will resume it');

  h.store.transitionDeployment = transition;
  h.driver.buildError = null;
  assert.equal(await runDeployment(h.deps, deployment.id), 'done', 'the project lock was released');
  assert.equal((await h.store.getDeployment(deployment.id))!.state, 'healthy');
});

test('containers receive decrypted environment values, and logs never do', async () => {
  const h = harness();
  const project = await h.project({ port: 8080 });
  await h.setEnv(project.id, { API_KEY: 'sk-live-very-secret', MODE: 'production', MULTI: 'line-one-secret\nline-two-secret' });
  h.driver.buildOutput = ['step 1: echo sk-live-very-secret', 'step 2: mode=production line-two-secret'];
  h.driver.buildError = new Error('command failed: curl -H "Authorization: sk-live-very-secret"');

  const failed = await deploy(h, project.id);
  const text = `${await h.logText(failed.id)}\n${failed.deployment.error}`;
  assert.ok(!text.includes('sk-live-very-secret'));
  assert.ok(!text.includes('line-two-secret'));
  assert.match(text, /step 1: echo \[redacted\]/);
  assert.match(failed.deployment.error ?? '', /Authorization: \[redacted\]/);

  h.driver.buildError = null;
  await deploy(h, project.id);
  assert.deepEqual(h.driver.runs.at(-1)?.env, { API_KEY: 'sk-live-very-secret', MODE: 'production', MULTI: 'line-one-secret\nline-two-secret', PORT: '8080' });
});

test('a value saved under a different encryption key fails the deployment with guidance', async () => {
  const h = harness();
  const project = await h.project();
  await h.setEnv(project.id, { API_KEY: 'secret-value' });
  const { deployment } = await deploy({ ...h, deps: { ...h.deps, encryptionKey: 'cd'.repeat(32) } }, project.id);
  assert.equal(deployment.state, 'failed');
  assert.match(deployment.error ?? '', /Could not decrypt environment variable API_KEY/);
  assert.deepEqual(h.driver.calls, [], 'nothing was cloned or built');
});

test('build output is capped', async () => {
  const h = harness({ maxBuildLogLines: 50 });
  const project = await h.project();
  h.driver.buildOutput = Array.from({ length: 500 }, (_, i) => `noise ${i}`);
  const { id, deployment } = await deploy(h, project.id);
  assert.equal(deployment.state, 'healthy');
  const lines = await h.store.getLogs(id, 0, 10_000);
  assert.equal(lines.length, 51);
  assert.equal(lines.at(-1)?.message, '[log truncated after 50 lines]');
});

test('old images are pruned but recent healthy releases stay available', async () => {
  const h = harness({ retainedReleases: 1 });
  const project = await h.project();
  const one = await deploy(h, project.id);
  const two = await deploy(h, project.id);
  const three = await deploy(h, project.id);

  assert.deepEqual([...h.driver.images].sort(), [two.deployment.image, three.deployment.image].sort());
  assert.equal((await h.store.getDeployment(one.id))!.imageRetained, false);
  assert.equal((await h.store.getDeployment(two.id))!.imageRetained, true);
  assert.equal(h.driver.running(project.id).length, 1);
});
