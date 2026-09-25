import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

import app from '../src/app.js';
import config from '../src/config/index.js';
import * as db from '../src/db/index.js';
import { CODES, SUCCESS_CODE } from '../src/utils/response.js';

const base = '/api/v1/users';

/**
 * These hit real SQL, so they need a database. Locally that means setting
 * DATABASE_URL in .env.test and running `npm run db:migrate`; CI always has one,
 * so the suite is never silently skipped where it matters.
 */
const describeDb = config.db.url ? describe : describe.skip;

describeDb('users', () => {
  before(async () => {
    await db.connect();
    await db.query('TRUNCATE users');
  });

  after(async () => {
    await db.disconnect();
  });

  it('lists users with pagination metadata', async () => {
    const res = await request(app).get(base).query({ page: 1, limit: 5 });

    assert.equal(res.status, 200);
    assert.equal(res.body.code, SUCCESS_CODE);
    assert.equal(res.body.message, CODES.SUCCESS.message);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.meta.page, 1);
    assert.equal(res.body.meta.limit, 5);
    assert.equal(res.body.err_show_type, undefined);
  });

  it('creates, reads, updates and deletes a user', async () => {
    const email = `t-${Date.now()}@example.com`;

    const createRes = await request(app).post(base).send({ name: 'Alice', email });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.code, SUCCESS_CODE);
    assert.equal(createRes.body.message, 'Tạo user thành công');
    const { id } = createRes.body.data;

    const getRes = await request(app).get(`${base}/${id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.email, email);

    const patchRes = await request(app).patch(`${base}/${id}`).send({ name: 'Alice B' });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.name, 'Alice B');
    assert.equal(patchRes.body.message, 'Cập nhật user thành công');

    const delRes = await request(app).delete(`${base}/${id}`);
    assert.equal(delRes.status, 204);

    const goneRes = await request(app).get(`${base}/${id}`);
    assert.equal(goneRes.status, 404);
  });

  it('rejects an invalid body with validation details', async () => {
    const res = await request(app).post(base).send({ name: '', email: 'not-an-email' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, CODES.VALIDATION_ERROR.code);
    assert.equal(res.body.err_show_type, CODES.VALIDATION_ERROR.showType);
    assert.ok(res.body.details.length >= 2);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await request(app).post(base).send({ name: 'A', email });

    const res = await request(app).post(base).send({ name: 'B', email });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, CODES.CONFLICT.code);
    assert.equal(res.body.err_show_type, CODES.CONFLICT.showType);
  });
  it('normalises the email before storing it', async () => {
    const res = await request(app)
      .post(base)
      .send({ name: '  Padded  ', email: '  MiXeD@Example.COM ' });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.email, 'mixed@example.com');
    assert.equal(res.body.data.name, 'Padded');
  });

  it('treats emails as case-insensitive for uniqueness', async () => {
    const email = `case-${Date.now()}@example.com`;
    await request(app).post(base).send({ name: 'Lower', email });

    const res = await request(app).post(base).send({ name: 'Upper', email: email.toUpperCase() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, CODES.CONFLICT.code);
  });

  it('lets the unique constraint settle a race, so only one insert wins', async () => {
    const email = `race-${Date.now()}@example.com`;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(base)
          .send({ name: `Racer ${i}`, email })
      )
    );

    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
  });

  it('rejects updating to an email another user already holds', async () => {
    const stamp = Date.now();
    const taken = `taken-${stamp}@example.com`;
    await request(app).post(base).send({ name: 'Holder', email: taken });

    const other = await request(app)
      .post(base)
      .send({ name: 'Other', email: `other-${stamp}@example.com` });

    const res = await request(app).patch(`${base}/${other.body.data.id}`).send({ email: taken });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, CODES.CONFLICT.code);
  });

  it('keeps its own email on a name-only update', async () => {
    const email = `keep-${Date.now()}@example.com`;
    const created = await request(app).post(base).send({ name: 'Before', email });

    const res = await request(app).patch(`${base}/${created.body.data.id}`).send({ name: 'After' });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, 'After');
    assert.equal(res.body.data.email, email);
  });

  it('reports a real total while paging', async () => {
    await db.query('TRUNCATE users');
    for (let i = 0; i < 7; i += 1) {
      await request(app)
        .post(base)
        .send({ name: `Paged ${i}`, email: `paged-${i}@example.com` });
    }

    const page2 = await request(app).get(base).query({ page: 2, limit: 3 });

    assert.equal(page2.body.data.length, 3);
    assert.deepEqual(page2.body.meta, { page: 2, limit: 3, total: 7, totalPages: 3 });

    const page3 = await request(app).get(base).query({ page: 3, limit: 3 });
    assert.equal(page3.body.data.length, 1);
    assert.equal(page3.body.meta.total, 7);
  });

  it('pages without repeating or dropping a row', async () => {
    await db.query('TRUNCATE users');
    for (let i = 0; i < 6; i += 1) {
      await request(app)
        .post(base)
        .send({ name: `Seq ${i}`, email: `seq-${i}@example.com` });
    }

    const seen = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app).get(base).query({ page, limit: 2 });
      seen.push(...res.body.data.map((u) => u.id));
    }

    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6, 'a row appeared on two pages');
  });

  it('searches by name and email', async () => {
    await db.query('TRUNCATE users');
    await request(app).post(base).send({ name: 'Findable', email: 'findable@example.com' });
    await request(app).post(base).send({ name: 'Hidden', email: 'hidden@example.com' });

    const byName = await request(app).get(base).query({ q: 'findab' });
    assert.equal(byName.body.meta.total, 1);
    assert.equal(byName.body.data[0].name, 'Findable');

    const byEmail = await request(app).get(base).query({ q: 'hidden@' });
    assert.equal(byEmail.body.meta.total, 1);
  });

  it('treats _ and % in a search term literally, not as wildcards', async () => {
    await db.query('TRUNCATE users');
    await request(app).post(base).send({ name: 'a_b', email: 'underscore@example.com' });
    await request(app).post(base).send({ name: 'axb', email: 'wildcard@example.com' });

    const res = await request(app).get(base).query({ q: 'a_b' });

    assert.equal(res.body.meta.total, 1, 'a_b must not match axb');
    assert.equal(res.body.data[0].name, 'a_b');
  });

  it('404s when deleting a user that is not there', async () => {
    const res = await request(app).delete(`${base}/11111111-2222-3333-4444-555555555555`);

    assert.equal(res.status, 404);
    assert.equal(res.body.code, CODES.NOT_FOUND.code);
  });

  it('returns createdAt and updatedAt in camelCase', async () => {
    const res = await request(app)
      .post(base)
      .send({ name: 'Stamped', email: `stamped-${Date.now()}@example.com` });

    assert.match(res.body.data.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(res.body.data.updatedAt);
    assert.equal('created_at' in res.body.data, false);
  });
});
