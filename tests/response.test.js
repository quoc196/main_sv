import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';

import errorHandler from '../src/middlewares/errorHandler.js';
import responseMiddleware from '../src/middlewares/response.js';
import ApiError from '../src/utils/ApiError.js';
import { CODES, SUCCESS_CODE, failure, success } from '../src/utils/response.js';

describe('success envelope', () => {
  it('defaults data and message', () => {
    assert.deepEqual(success(), {
      code: SUCCESS_CODE,
      message: CODES.SUCCESS.message,
      data: {},
    });
  });

  it('omits meta when there is none, and never carries err_show_type', () => {
    const body = success({ data: { id: 1 }, message: 'Xong' });

    assert.equal(body.message, 'Xong');
    assert.equal('meta' in body, false);
    assert.equal('err_show_type' in body, false);
  });
});

describe('failure envelope', () => {
  it('maps an ApiError code to the table row', () => {
    const body = failure('CONFLICT');

    assert.equal(body.code, CODES.CONFLICT.code);
    assert.equal(body.err_show_type, CODES.CONFLICT.showType);
    assert.equal(body.message, CODES.CONFLICT.message);
    assert.deepEqual(body.data, {});
  });

  it('falls back to ERROR for a code with no row, without leaking the name', () => {
    const body = failure('SOME_INTERNAL_THING');

    assert.equal(body.code, CODES.ERROR.code);
    assert.equal(body.message, CODES.ERROR.message);
    assert.ok(!JSON.stringify(body).includes('SOME_INTERNAL_THING'));
  });

  it('omits optional fields rather than sending nulls', () => {
    const body = failure('NOT_FOUND');

    for (const key of ['details', 'requestId', 'stack', 'meta']) {
      assert.equal(key in body, false, `${key} should be absent`);
    }
  });
});

describe('res helpers', () => {
  const build = (handler) => {
    const api = express();
    api.use(responseMiddleware);
    api.get('/', handler);
    api.use(errorHandler);
    return api;
  };

  it('res.paginated computes totalPages', async () => {
    const res = await request(
      build((_req, r) => r.paginated([1, 2], { page: 2, limit: 2, total: 7 }))
    ).get('/');

    assert.equal(res.status, 200);
    assert.equal(res.body.code, SUCCESS_CODE);
    assert.deepEqual(res.body.meta, { page: 2, limit: 2, total: 7, totalPages: 4 });
  });

  it('res.noContent sends no body', async () => {
    const res = await request(build((_req, r) => r.noContent())).get('/');

    assert.equal(res.status, 204);
    assert.deepEqual(res.body, {});
  });

  it('res.created carries an overridden message', async () => {
    const res = await request(build((_req, r) => r.created({ id: 9 }, { message: 'Đã tạo' }))).get(
      '/'
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.message, 'Đã tạo');
  });
});

describe('developer messages stay off the wire', () => {
  const build = (err) => {
    const api = express();
    api.get('/', (_req, _res, next) => next(err));
    api.use(errorHandler);
    return api;
  };

  // NODE_ENV=test, so the development escape hatch in errorHandler is inactive.
  it('an ApiError without userMessage sends the neutral copy', async () => {
    const res = await request(
      build(ApiError.notFound('User 42 living at secret-host not found'))
    ).get('/');

    assert.equal(res.status, 404);
    assert.equal(res.body.message, CODES.NOT_FOUND.message);
    assert.ok(!JSON.stringify(res.body).includes('secret-host'));
  });

  it('a plain 500 never leaks its message', async () => {
    const res = await request(build(new Error('connection to 10.0.0.5 refused'))).get('/');

    assert.equal(res.status, 500);
    assert.equal(res.body.code, CODES.INTERNAL_SERVER_ERROR.code);
    assert.equal(res.body.message, CODES.INTERNAL_SERVER_ERROR.message);
    assert.ok(!JSON.stringify(res.body).includes('10.0.0.5'));
  });

  it('userMessage is what the caller sees', async () => {
    const res = await request(
      build(ApiError.conflict('Email a@b.c is already taken', { userMessage: 'Email đã tồn tại' }))
    ).get('/');

    assert.equal(res.body.message, 'Email đã tồn tại');
    assert.ok(!JSON.stringify(res.body).includes('a@b.c'));
  });
});

describe('status codes without a row of their own', () => {
  const build = (status) => {
    const api = express();
    api.get('/', (_req, _res, next) => next(Object.assign(new Error('x'), { status })));
    api.use(errorHandler);
    return api;
  };

  it('413 has its own code instead of "system error"', async () => {
    const res = await request(build(413)).get('/');

    assert.equal(res.status, 413);
    assert.equal(res.body.code, CODES.PAYLOAD_TOO_LARGE.code);
  });

  it('an unlisted 4xx is a bad request, never the 99 fallback', async () => {
    const res = await request(build(415)).get('/');

    assert.equal(res.status, 415);
    assert.equal(res.body.code, CODES.BAD_REQUEST.code);
  });
});
