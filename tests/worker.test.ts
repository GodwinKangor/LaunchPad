import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadWorkerConfig } from '@/lib/config';
import { cloneArgs, containerSpec } from '@/worker/docker';
import { CommandError, baseEnv, exec } from '@/worker/exec';

test('application containers are sandboxed and resource limited', () => {
  const config = loadWorkerConfig({ APP_MEMORY_MB: '256', APP_CPUS: '0.5', APP_PIDS_LIMIT: '100' });
  const spec = containerSpec({ name: 'lp-blog-1', image: 'launchpad/blog:1', port: 3000, env: { A: 'x y', PORT: '3000' }, projectId: 'p1', deploymentId: 'd1' }, config);
  const host = spec.HostConfig;

  assert.equal(host.Privileged, false);
  assert.deepEqual(host.Binds, [], 'no host paths, so the Docker socket can never be mounted');
  assert.deepEqual(host.PortBindings, {}, 'nothing is published on the host; traffic arrives through the proxy');
  assert.ok(!JSON.stringify(spec).includes('docker.sock'));
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.ok(!host.CapAdd.includes('SYS_ADMIN') && !host.CapAdd.includes('NET_ADMIN') && !host.CapAdd.includes('NET_RAW'));
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.equal(host.Memory, 256 * 1024 * 1024);
  assert.equal(host.MemorySwap, host.Memory, 'no swap beyond the memory limit');
  assert.equal(host.NanoCpus, 500_000_000);
  assert.equal(host.PidsLimit, 100);
  assert.deepEqual(host.LogConfig, { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } });
  assert.equal(host.NetworkMode, 'launchpad_apps');
  assert.equal(host.RestartPolicy.Name, 'no');
  assert.deepEqual(spec.Env, ['A=x y', 'PORT=3000']);
  assert.deepEqual(spec.Labels, { 'launchpad.managed': 'true', 'launchpad.project': 'p1', 'launchpad.deployment': 'd1' });
});

test('git receives user input only as positional arguments after "--"', () => {
  const args = cloneArgs('https://github.com/me/blog.git', 'main', '/tmp/x');
  const separator = args.indexOf('--');
  assert.deepEqual(args.slice(separator + 1), ['https://github.com/me/blog.git', '/tmp/x']);
  assert.equal(args[args.indexOf('--branch') + 1], 'main');
  assert.ok(args.includes('protocol.file.allow=never'));
  assert.ok(!args.includes('--recurse-submodules'));
});

test('subprocesses run without a shell and without the worker secrets', async () => {
  const hostile = '$(echo injected); `id` && echo "x" | cat > /dev/null';
  const { stdout } = await exec('printf', ['%s', hostile]);
  assert.equal(stdout, hostile, 'shell metacharacters are passed through literally');

  process.env.DATABASE_URL = 'postgresql://secret';
  process.env.ENV_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    assert.deepEqual(Object.keys(baseEnv()).filter((k) => /DATABASE|REDIS|ENCRYPTION|SECRET|PASSWORD/.test(k)), []);
    const env = await exec('env', []);
    assert.ok(!env.stdout.includes('postgresql://secret'));
    assert.ok(!env.stdout.includes('ENV_ENCRYPTION_KEY'));
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.ENV_ENCRYPTION_KEY;
  }
});

test('subprocess output is streamed by line, and failures and timeouts are reported', async () => {
  const lines: string[] = [];
  await exec('printf', ['one\\ntwo\\rthree'], { onLine: (line) => lines.push(line) });
  assert.deepEqual(lines, ['one', 'two', 'three']);

  await assert.rejects(exec('ls', ['/definitely/not/here']), (err: unknown) => err instanceof CommandError && err.exitCode !== 0 && !err.timedOut && err.lastLine.length > 0);
  await assert.rejects(exec('launchpad-no-such-binary', []), (err: unknown) => err instanceof CommandError && err.exitCode === null);
  const started = Date.now();
  await assert.rejects(exec('sleep', ['30'], { timeoutMs: 200 }), (err: unknown) => err instanceof CommandError && err.timedOut);
  assert.ok(Date.now() - started < 5_000, 'the process was killed at the deadline');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test('the dashboard cannot reach Docker: no subprocess, socket or worker imports outside worker/', () => {
  const root = path.resolve(__dirname, '..');
  const files = [...['app', 'components', 'lib'].flatMap((dir) => sourceFiles(path.join(root, dir))), path.join(root, 'middleware.ts')];
  assert.ok(files.length > 30);
  const offenders = files.filter((file) => /child_process|docker\.sock|from ['"](@\/|(\.\.\/)+)worker\//.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
});
