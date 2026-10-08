import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { SignJWT } from 'jose';
import request from 'supertest';

import app from '../src/app.js';
import config from '../src/config/index.js';
import * as db from '../src/db/index.js';
import { signAccessToken } from '../src/modules/auth/token.service.js';
import { CODES, SUCCESS_CODE } from '../src/utils/response.js';

const base = '/api/v1/auth';
const password = 'correct horse battery';

const register = (email, overrides = {}) =>
  request(app)
    .post(`${base}/register`)
    .send({ name: 'Auth User', email, password, ...overrides });

const login = (email, pw = password) =>
  request(app).post(`${base}/login`).send({ email, password: pw });

const me = (accessToken) =>
  request(app).get(`${base}/me`).set('authorization', `Bearer ${accessToken}`);

const refresh = (refreshToken) => request(app).post(`${base}/refresh`).send({ refreshToken });

let seq = 0;
const freshEmail = () => `auth-${Date.now()}-${(seq += 1)}@example.com`;

describe('access token checks (no database)', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await request(app).get(`${base}/me`);

    assert.equal(res.status, 401);
    assert.equal(res.body.code, CODES.UNAUTHORIZED.code);
    assert.equal(res.body.err_show_type, CODES.UNAUTHORIZED.showType);
  });

  it('tells an expired token apart, so the client refreshes instead of logging out', async () => {
    const key = new TextEncoder().encode(config.jwt.secret);
    const expired = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer(config.app.name)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);

    const res = await me(expired);

    assert.equal(res.status, 401);
    assert.equal(res.body.code, CODES.TOKEN_EXPIRED.code);
    assert.equal(res.body.err_show_type, CODES.TOKEN_EXPIRED.showType);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer(config.app.name)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('not-the-real-secret-at-all'));

    const res = await me(forged);

    assert.equal(res.status, 401);
    assert.equal(res.body.code, CODES.UNAUTHORIZED.code);
  });

  it('rejects a token from another environment (issuer)', async () => {
    const otherEnv = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(randomUUID())
      .setIssuer('some-other-app')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.jwt.secret));

    const res = await me(otherEnv);

    assert.equal(res.status, 401);
  });

  it('rejects an unsigned (alg: none) token', async () => {
    const valid = await signAccessToken({ id: randomUUID(), role: 'admin' });
    const [, payload] = valid.split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');

    const res = await me(`${header}.${payload}.`);

    assert.equal(res.status, 401);
  });
});

const describeDb = config.db.url ? describe : describe.skip;

describeDb('auth flow', () => {
  before(async () => {
    await db.connect();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE users CASCADE');
  });

  after(async () => {
    await db.disconnect();
  });

  it('registers a plain user and returns a working session', async () => {
    const email = freshEmail();
    const res = await register(email, { role: 'admin' });

    assert.equal(res.status, 201);
    assert.equal(res.body.code, SUCCESS_CODE);
    assert.equal(res.body.data.user.email, email);
    assert.equal(res.body.data.user.role, 'user', 'sign-up must not be able to pick its role');
    assert.equal(res.body.data.tokenType, 'Bearer');
    assert.equal(typeof res.body.data.expiresIn, 'number');
    assert.ok(res.body.data.refreshToken);
    assert.ok(!JSON.stringify(res.body).includes('scrypt'));

    const meRes = await me(res.body.data.accessToken);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.data.email, email);
  });

  it('rejects a short password at sign-up', async () => {
    const res = await register(freshEmail(), { password: 'short' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, CODES.VALIDATION_ERROR.code);
  });

  it('rejects signing up twice with the same email', async () => {
    const email = freshEmail();
    await register(email);

    const res = await register(email.toUpperCase());
    assert.equal(res.status, 409);
  });

  it('logs in with the right password, case-insensitively on email', async () => {
    const email = freshEmail();
    await register(email);

    const res = await login(email.toUpperCase());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, email);
    assert.ok(res.body.data.accessToken);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const email = freshEmail();
    await register(email);

    const wrong = await login(email, 'not the password');
    const unknown = await login(freshEmail());

    for (const res of [wrong, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.code, CODES.INVALID_CREDENTIALS.code);
      assert.equal(res.body.message, CODES.INVALID_CREDENTIALS.message);
    }
  });

  it('refuses login for an account that has no password yet', async () => {
    const email = freshEmail();
    await db.query("INSERT INTO users (name, email) VALUES ('No Pw', $1)", [email]);

    const res = await login(email, 'anything-at-all');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, CODES.INVALID_CREDENTIALS.code);
  });

  it('rotates the refresh token, and the new one keeps working', async () => {
    const { body } = await register(freshEmail());

    const first = await refresh(body.data.refreshToken);
    assert.equal(first.status, 200);
    assert.notEqual(first.body.data.refreshToken, body.data.refreshToken);
    assert.equal((await me(first.body.data.accessToken)).status, 200);

    const second = await refresh(first.body.data.refreshToken);
    assert.equal(second.status, 200);
  });

  it('revokes the whole session when a rotated token is replayed', async () => {
    const { body } = await register(freshEmail());
    const stolen = body.data.refreshToken;

    const legit = await refresh(stolen);
    assert.equal(legit.status, 200);

    const replay = await refresh(stolen);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, CODES.UNAUTHORIZED.code);

    // The legitimate holder's newer token died with the family.
    const after = await refresh(legit.body.data.refreshToken);
    assert.equal(after.status, 401);
  });

  it('lets exactly one of two concurrent refreshes win', async () => {
    const { body } = await register(freshEmail());

    const results = await Promise.all([
      refresh(body.data.refreshToken),
      refresh(body.data.refreshToken),
    ]);

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  });

  it('keeps separate logins independent', async () => {
    const email = freshEmail();
    const phone = (await register(email)).body.data.refreshToken;
    const laptop = (await login(email)).body.data.refreshToken;

    await request(app).post(`${base}/logout`).send({ refreshToken: phone });

    assert.equal((await refresh(phone)).status, 401);
    assert.equal((await refresh(laptop)).status, 200);
  });

  it('rejects an unknown or expired refresh token', async () => {
    assert.equal((await refresh('made-up-token')).status, 401);

    const { body } = await register(freshEmail());
    await db.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'");

    assert.equal((await refresh(body.data.refreshToken)).status, 401);
  });

  it('logout is idempotent', async () => {
    const res = await request(app).post(`${base}/logout`).send({ refreshToken: 'never-issued' });
    assert.equal(res.status, 204);
  });

  it('a password change by an admin ends every session of that user', async () => {
    const { body } = await register(freshEmail());
    const adminAuth = `Bearer ${await signAccessToken({ id: randomUUID(), role: 'admin' })}`;

    const patch = await request(app)
      .patch(`/api/v1/users/${body.data.user.id}`)
      .set('authorization', adminAuth)
      .send({ password: 'a brand new password' });
    assert.equal(patch.status, 200);

    assert.equal((await refresh(body.data.refreshToken)).status, 401);
    assert.equal((await login(body.data.user.email, 'a brand new password')).status, 200);
  });

  it('picks up a role change at the next refresh', async () => {
    const { body } = await register(freshEmail());
    await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [body.data.user.id]);

    const res = await refresh(body.data.refreshToken);
    const users = await request(app)
      .get('/api/v1/users')
      .set('authorization', `Bearer ${res.body.data.accessToken}`);

    assert.equal(res.body.data.user.role, 'admin');
    assert.equal(users.status, 200);
  });

  it('stores only a hash of the refresh token', async () => {
    const { body } = await register(freshEmail());
    const { rows } = await db.query('SELECT token_hash FROM refresh_tokens');

    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, body.data.refreshToken);
  });
});
