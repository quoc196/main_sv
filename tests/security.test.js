import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';

import app from '../src/app.js';
import config from '../src/config/index.js';
import { CODES } from '../src/utils/response.js';

describe('request id', () => {
  it('reuses a well-formed upstream id', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const res = await request(app).get('/health').set('x-request-id', id);

    assert.equal(res.headers['x-request-id'], id);
  });

  it('replaces an oversized id instead of echoing it', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'A'.repeat(300));

    assert.notEqual(res.headers['x-request-id'], 'A'.repeat(300));
    assert.equal(res.headers['x-request-id'].length, 36);
  });

  it('replaces an id containing unexpected characters', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'abc def<script>');

    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  });

  it('always sets an id when the client sends none', async () => {
    const res = await request(app).get('/health');

    assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  });
});

describe('cors', () => {
  // The test env runs with CORS_ORIGINS=*, which is exactly the combination
  // that used to reflect any origin back with credentials enabled.
  it('never reflects the caller origin while allowing credentials', async () => {
    const res = await request(app).get('/health').set('origin', 'https://evil.example');

    assert.equal(config.cors.allowAll, true);
    assert.notEqual(res.headers['access-control-allow-origin'], 'https://evil.example');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });
});

describe('error envelope', () => {
  it('does not leak the x-powered-by header', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('turns malformed JSON into the standard envelope', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('content-type', 'application/json')
      .send('{nope');

    assert.equal(res.status, 400);
    assert.equal(res.body.code, CODES.BAD_REQUEST.code);
    assert.equal(res.body.err_show_type, CODES.BAD_REQUEST.showType);
    assert.ok(res.body.requestId);
  });
});

describe('errorHandler after headers are sent', () => {
  // Mounted standalone: the guard only matters once a handler has already
  // started writing, which no normal route in this app does.
  it('destroys the connection instead of throwing ERR_HTTP_HEADERS_SENT', async () => {
    const express = (await import('express')).default;
    const errorHandler = (await import('../src/middlewares/errorHandler.js')).default;

    const broken = express();
    broken.get('/stream', (_req, res, next) => {
      res.status(200).write('partial');
      next(new Error('stream blew up halfway'));
    });
    broken.use(errorHandler);

    await assert.rejects(() => request(broken).get('/stream'), /socket hang up|ECONNRESET/);
  });
});
