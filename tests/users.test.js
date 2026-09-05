import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';

import app from '../src/app.js';

const base = '/api/v1/users';

describe('users', () => {
  it('lists users with pagination metadata', async () => {
    const res = await request(app).get(base).query({ page: 1, limit: 5 });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.meta.page, 1);
    assert.equal(res.body.meta.limit, 5);
  });

  it('creates, reads, updates and deletes a user', async () => {
    const email = `t-${Date.now()}@example.com`;

    const createRes = await request(app).post(base).send({ name: 'Alice', email });
    assert.equal(createRes.status, 201);
    const { id } = createRes.body.data;

    const getRes = await request(app).get(`${base}/${id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.email, email);

    const patchRes = await request(app).patch(`${base}/${id}`).send({ name: 'Alice B' });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.data.name, 'Alice B');

    const delRes = await request(app).delete(`${base}/${id}`);
    assert.equal(delRes.status, 204);

    const goneRes = await request(app).get(`${base}/${id}`);
    assert.equal(goneRes.status, 404);
  });

  it('rejects an invalid body with validation details', async () => {
    const res = await request(app).post(base).send({ name: '', email: 'not-an-email' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.length >= 2);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await request(app).post(base).send({ name: 'A', email });

    const res = await request(app).post(base).send({ name: 'B', email });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });
});
