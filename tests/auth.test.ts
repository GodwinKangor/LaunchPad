import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authed } from '@/lib/api';
import { LoginThrottle, assertSameOrigin, getSession, verifyCredentials } from '@/lib/auth';
import { decryptValue, encryptValue, envAad } from '@/lib/crypto';
import { ForbiddenError } from '@/lib/errors';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from '@/lib/session';

// Demo mode gives authConfig() a deterministic secret without any .env file.
process.env.DEMO_MODE = 'true';
const SECRET = 'demo-mode-insecure-session-secret-not-for-real-use';

test('session tokens verify, expire and reject tampering', async () => {
  const now = Date.UTC(2026, 0, 1);
  const token = await createSessionToken('owner', SECRET, now);
  assert.deepEqual(await verifySessionToken(token, SECRET, now), { userId: 'owner', expiresAt: now + SESSION_TTL_SECONDS * 1000 });
  assert.equal(await verifySessionToken(token, SECRET, now + SESSION_TTL_SECONDS * 1000), null, 'expired');
  assert.equal(await verifySessionToken(token, 'a-different-secret-of-sufficient-length', now), null, 'wrong secret');

  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'attacker', exp: 9_999_999_999 })).toString('base64url');
  assert.equal(await verifySessionToken(`${forged}.${signature}`, SECRET, now), null, 'payload swapped');
  assert.equal(await verifySessionToken(`${payload}.${signature.slice(0, -2)}AA`, SECRET, now), null, 'signature altered');
  assert.equal(await verifySessionToken(`${payload}.`, SECRET, now), null);
  assert.equal(await verifySessionToken('garbage', SECRET, now), null);
  assert.equal(await verifySessionToken(undefined, SECRET, now), null);
});

test('credentials must match exactly', () => {
  const config = { ownerEmail: 'owner@example.com', ownerPassword: 'correct horse battery' };
  assert.ok(verifyCredentials(' Owner@Example.com ', 'correct horse battery', config));
  assert.ok(!verifyCredentials('owner@example.com', 'correct horse batter', config));
  assert.ok(!verifyCredentials('other@example.com', 'correct horse battery', config));
  assert.ok(!verifyCredentials('', '', config));
});

test('login throttle locks out after repeated failures and recovers', () => {
  const throttle = new LoginThrottle(3, 60_000);
  assert.equal(throttle.retryAfterSeconds(0), 0);
  throttle.recordFailure(0);
  throttle.recordFailure(1_000);
  assert.equal(throttle.retryAfterSeconds(2_000), 0);
  throttle.recordFailure(2_000);
  assert.equal(throttle.retryAfterSeconds(3_000), 57);
  assert.equal(throttle.retryAfterSeconds(60_001), 0, 'window slides');
});

const request = (method: string, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/projects', { method, headers });

test('cross-site writes are rejected', () => {
  assert.doesNotThrow(() => assertSameOrigin(request('GET', { origin: 'https://evil.example' })));
  assert.doesNotThrow(() => assertSameOrigin(request('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' })));
  assert.doesNotThrow(() => assertSameOrigin(request('POST', { 'sec-fetch-site': 'same-origin' })));
  assert.throws(() => assertSameOrigin(request('POST', { origin: 'https://evil.example', host: 'localhost:3000' })), ForbiddenError);
  assert.throws(() => assertSameOrigin(request('DELETE', { origin: 'null', host: 'localhost:3000' })), ForbiddenError);
  assert.throws(() => assertSameOrigin(request('POST', { 'sec-fetch-site': 'cross-site' })), ForbiddenError);
});

test('API routes refuse requests without a valid session', async () => {
  let calls = 0;
  const route = authed(async ({ session }) => {
    calls++;
    return { userId: session.userId };
  });
  const args = { params: Promise.resolve({}) };

  const anonymous = await route(request('GET'), args);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'unauthorized');

  const forged = await route(request('GET', { cookie: `${SESSION_COOKIE}=eyJzdWIiOiJvd25lciJ9.AAAA` }), args);
  assert.equal(forged.status, 401);

  const expired = await createSessionToken('owner', SECRET, Date.now() - (SESSION_TTL_SECONDS + 60) * 1000);
  assert.equal((await route(request('GET', { cookie: `${SESSION_COOKIE}=${expired}` }), args)).status, 401);
  assert.equal(calls, 0, 'handler never ran');

  const cookie = `other=1; ${SESSION_COOKIE}=${await createSessionToken('owner', SECRET)}`;
  const ok = await route(request('GET', { cookie }), args);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { userId: 'owner' });
  assert.equal((await getSession(request('GET', { cookie })))?.userId, 'owner');

  const crossSite = await route(request('POST', { cookie, origin: 'https://evil.example', host: 'localhost:3000' }), args);
  assert.equal(crossSite.status, 403, 'a valid cookie is not enough for a cross-site write');
  assert.equal(calls, 1);
});

test('unexpected errors do not leak details to the client', async (t) => {
  t.mock.method(console, 'error', () => {});
  const route = authed(async () => {
    throw new Error('connect ECONNREFUSED postgresql://launchpad:hunter2@db:5432');
  });
  const cookie = `${SESSION_COOKIE}=${await createSessionToken('owner', SECRET)}`;
  const res = await route(request('GET', { cookie }), { params: Promise.resolve({}) });
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes('hunter2'));
});

test('environment values are encrypted, authenticated and bound to their row', () => {
  const key = 'ab'.repeat(32);
  const aad = envAad('project-1', 'DATABASE_URL');
  const sealed = encryptValue('postgres://user:pass@host/db', key, aad);
  assert.ok(!sealed.includes('pass'));
  assert.notEqual(sealed, encryptValue('postgres://user:pass@host/db', key, aad), 'fresh IV every time');
  assert.equal(decryptValue(sealed, key, aad), 'postgres://user:pass@host/db');
  assert.equal(decryptValue(encryptValue('', key, aad), key, aad), '');
  assert.throws(() => decryptValue(sealed, 'cd'.repeat(32), aad), 'wrong key');
  assert.throws(() => decryptValue(sealed, key, envAad('project-2', 'DATABASE_URL')), 'moved to another project');
  const parts = sealed.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptValue(parts.join('.'), key, aad), 'tampered ciphertext');
});
