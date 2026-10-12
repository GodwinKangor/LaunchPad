import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runDeployment } from '@/lib/engine/deploy';
import { pollHealth, type HealthProbe } from '@/lib/engine/health';
import { DeployError } from '@/lib/engine/types';
import { CaddyRouter, renderRoute } from '@/worker/caddy';
import { harness, type Harness } from './fakes';

async function deploy(h: Harness, projectId: string) {
  const deployment = await h.store.beginDeployment(projectId, { kind: 'deploy', branch: 'main' });
  await runDeployment(h.deps, deployment.id);
  return (await h.store.getDeployment(deployment.id))!;
}

/** A probe that replays a script of responses, with a fake clock so no test waits. */
function scripted(responses: (number | null)[], exitAt = Infinity) {
  let clock = 0;
  let requests = 0;
  const probe: HealthProbe = {
    state: async () => (requests >= exitAt ? { running: false, detail: 'exit code 1' } : { running: true }),
    request: async () => responses[Math.min(requests++, responses.length - 1)],
  };
  const timing = { now: () => clock, sleep: async (ms: number) => void (clock += ms) };
  return { probe, timing, requests: () => requests };
}

test('health polling waits for consecutive good responses', async () => {
  const s = scripted([null, null, 503, 200, 200]);
  const lines: string[] = [];
  const result = await pollHealth(s.probe, { timeoutMs: 60_000, path: '/healthz', port: 3000, ...s.timing }, (l) => lines.push(l));
  assert.deepEqual(result, { ok: true });
  assert.equal(s.requests(), 5);
  assert.deepEqual(lines, ['No response on port 3000 yet', 'GET /healthz -> 503', 'GET /healthz -> 200']);
});

test('one good response followed by a failure does not count as healthy', async () => {
  const s = scripted([200, 500, 500]);
  const result = await pollHealth(s.probe, { timeoutMs: 5_000, path: '/', port: 3000, ...s.timing });
  assert.equal(result.ok, false);
});

test('health polling reports why it gave up', async () => {
  const silent = scripted([null]);
  const noAnswer = await pollHealth(silent.probe, { timeoutMs: 30_000, path: '/', port: 8080, ...silent.timing });
  assert.ok(!noAnswer.ok && /nothing answered on port 8080 within 30s/.test(noAnswer.reason));
  assert.ok(silent.requests() >= 30 && silent.requests() <= 32, 'polls about once a second until the deadline');

  const erroring = scripted([404]);
  const wrongStatus = await pollHealth(erroring.probe, { timeoutMs: 10_000, path: '/health', port: 3000, ...erroring.timing });
  assert.ok(!wrongStatus.ok && /GET \/health returned HTTP 404/.test(wrongStatus.reason));

  const crashing = scripted([null], 3);
  const exited = await pollHealth(crashing.probe, { timeoutMs: 60_000, path: '/', port: 3000, ...crashing.timing });
  assert.ok(!exited.ok && /exited before becoming healthy \(exit code 1\)/.test(exited.reason));
  assert.equal(crashing.requests(), 3, 'stops immediately instead of waiting for the timeout');
});

test('a failed health check never receives traffic and the previous release keeps serving', async () => {
  const h = harness();
  const project = await h.project();
  const first = await deploy(h, project.id);
  const routeChanges = h.router.history.length;

  h.driver.health = { ok: false, reason: 'GET / returned HTTP 500 for 60s.' };
  h.driver.appLogs = ['Error: cannot connect to database'];
  const second = await deploy(h, project.id);

  assert.deepEqual(h.transitions.get(second.id), ['cloning', 'building', 'starting', 'failed']);
  assert.equal(second.error, 'Health check failed: GET / returned HTTP 500 for 60s.');
  assert.equal(second.containerName, null);
  assert.equal(h.router.history.length, routeChanges, 'routing was never touched');
  assert.equal(h.router.upstream('blog'), first.containerName);
  assert.deepEqual(h.driver.running(project.id), [first.containerName], 'the unhealthy container was removed');
  assert.deepEqual(h.driver.promoted, [first.containerName], 'the unhealthy container never got a restart policy');
  assert.ok(!h.driver.images.has(second.image ?? `launchpad/blog:${second.id}`));

  const after = (await h.store.getProject(project.id))!;
  assert.equal(after.activeDeploymentId, first.id);
  assert.equal(after.status, 'running');
  const log = await h.logText(second.id);
  assert.match(log, /Last output from the application:\n {2}Error: cannot connect to database/);
  assert.match(log, /previous release is still serving traffic/);
});

test('a first deployment that fails its health check leaves nothing running', async () => {
  const h = harness();
  const project = await h.project();
  h.driver.health = { ok: false, reason: 'nothing answered on port 3000 within 60s.' };
  const deployment = await deploy(h, project.id);
  assert.equal(deployment.state, 'failed');
  assert.equal(h.driver.containers.size, 0);
  assert.equal(h.router.routes.size, 0);
  const after = (await h.store.getProject(project.id))!;
  assert.equal(after.status, 'idle');
  assert.equal(after.activeDeploymentId, null);
});

test('if the proxy rejects the new route, the deployment fails and traffic stays on the old release', async () => {
  const h = harness();
  const project = await h.project();
  const first = await deploy(h, project.id);
  h.router.failNext = true;
  const second = await deploy(h, project.id);

  assert.equal(second.state, 'failed');
  assert.match(second.error ?? '', /Routing update failed/);
  assert.equal(h.router.upstream('blog'), first.containerName);
  assert.deepEqual(h.driver.running(project.id), [first.containerName]);
  assert.equal((await h.store.getProject(project.id))!.activeDeploymentId, first.id);
});

test('if the release cannot be recorded after traffic switched, traffic is switched back first', async () => {
  const h = harness();
  const project = await h.project();
  const first = await deploy(h, project.id);
  const promote = h.store.promoteDeployment;
  h.store.promoteDeployment = async () => {
    throw new Error('database unavailable');
  };
  const second = await deploy(h, project.id);
  h.store.promoteDeployment = promote;

  assert.equal(second.state, 'failed');
  assert.equal(h.router.upstream('blog'), first.containerName, 'route restored');
  const events = h.router.history.slice(-2).map((e) => (e.target?.kind === 'upstream' ? e.target.container : null));
  assert.equal(events[1], first.containerName);
  assert.notEqual(events[0], first.containerName);
  assert.deepEqual(h.driver.running(project.id), [first.containerName]);
});

const options = { domain: 'localhost', scheme: 'http' as const };

test('route snippets are rendered only from validated names', () => {
  assert.equal(renderRoute('blog', { kind: 'upstream', container: 'lp-blog-1a2b3c4d-ffeedd', port: 3000 }, options), 'http://blog.localhost {\n\treverse_proxy lp-blog-1a2b3c4d-ffeedd:3000\n}\n');
  assert.equal(
    renderRoute('blog', { kind: 'upstream', container: 'lp-blog-1', port: 80 }, { domain: 'apps.example.com', scheme: 'https' }),
    'blog.apps.example.com {\n\treverse_proxy lp-blog-1:80\n}\n',
  );
  assert.match(renderRoute('blog', { kind: 'stopped' }, options), /respond "This application is stopped\." 503/);
  assert.throws(() => renderRoute('blog {\n\trespond "pwned"\n}\n#', { kind: 'stopped' }, options));
  assert.throws(() => renderRoute('blog', { kind: 'upstream', container: 'evil.example.com', port: 80 }, options));
  assert.throws(() => renderRoute('blog', { kind: 'upstream', container: 'x }\nimport /etc/passwd', port: 80 }, options));
  assert.throws(() => renderRoute('blog', { kind: 'upstream', container: 'lp-blog-1', port: 0 }, options));
});

test('the Caddy router reloads on change, restores the old route when a reload fails, and prunes', async () => {
  const routesDir = await mkdtemp(path.join(os.tmpdir(), 'launchpad-routes-'));
  try {
    let reloads = 0;
    let failReload = false;
    const router = new CaddyRouter({
      ...options,
      routesDir,
      reload: async () => {
        reloads++;
        if (failReload) throw new Error('adapt: unrecognized directive');
      },
    });
    const file = path.join(routesDir, 'blog.caddy');
    const v1 = { kind: 'upstream' as const, container: 'lp-blog-v1', port: 3000 };
    const v2 = { kind: 'upstream' as const, container: 'lp-blog-v2', port: 3000 };

    await router.setRoute('blog', v1);
    assert.match(await readFile(file, 'utf8'), /reverse_proxy lp-blog-v1:3000/);
    assert.equal(reloads, 1);
    await router.setRoute('blog', v1);
    assert.equal(reloads, 1, 'no reload when nothing changed');

    failReload = true;
    await assert.rejects(router.setRoute('blog', v2), DeployError);
    assert.match(await readFile(file, 'utf8'), /lp-blog-v1/, 'file on disk matches what the proxy is still serving');
    await assert.rejects(router.setRoute('shop', v2), DeployError);
    assert.deepEqual(await readdir(routesDir), ['blog.caddy'], 'a failed first route leaves no file');
    failReload = false;

    await Promise.all([router.setRoute('blog', v2), router.setRoute('shop', { kind: 'stopped' })]);
    assert.match(await readFile(file, 'utf8'), /lp-blog-v2/);
    assert.deepEqual((await readdir(routesDir)).sort(), ['blog.caddy', 'shop.caddy']);

    await router.prune(['blog']);
    assert.deepEqual(await readdir(routesDir), ['blog.caddy']);
    await router.setRoute('blog', null);
    assert.deepEqual(await readdir(routesDir), []);
  } finally {
    await rm(routesDir, { recursive: true, force: true });
  }
});
