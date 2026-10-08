import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import request from 'supertest';

import app from '../src/app.js';
import { CODES } from '../src/utils/response.js';

describe('health', () => {
  it('GET /health returns the running environment', async () => {
    const res = await request(app).get('/health');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.env, 'test');
  });

  it('GET /health/live is dependency-free', async () => {
    const res = await request(app).get('/health/live');
    assert.equal(res.status, 200);
  });

  it('unknown routes return a 404 envelope', async () => {
    const res = await request(app).get('/nope');

    assert.equal(res.status, 404);
    assert.equal(res.body.code, CODES.NOT_FOUND.code);
    assert.equal(res.body.err_show_type, CODES.NOT_FOUND.showType);
    assert.deepEqual(res.body.data, {});
  });

  after(() => {});
});
