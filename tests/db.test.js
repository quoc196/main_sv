import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

import config from '../src/config/index.js';
import * as db from '../src/db/index.js';
import { CODES } from '../src/utils/response.js';

describe('without a database', () => {
  // config is resolved once per process, so a DB-less app needs its own.
  it('a DB-backed route answers 503, not 500', () => {
    const script = `
      import request from 'supertest';
      const { default: app } = await import('./src/app.js');
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@example.com', password: 'whatever' });
      console.log(JSON.stringify({ status: res.status, body: res.body }));
    `;
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', DATABASE_URL_UNPOOLED: '' },
      encoding: 'utf8',
    });
    assert.equal(out.status, 0, out.stderr);

    const { status, body } = JSON.parse(out.stdout.trim().split('\n').at(-1));
    assert.equal(status, 503);
    assert.equal(body.code, CODES.SERVICE_UNAVAILABLE.code);
    assert.equal(body.err_show_type, CODES.SERVICE_UNAVAILABLE.showType);
  });
});

const describeDb = config.db.url ? describe : describe.skip;

describeDb('transaction', () => {
  before(async () => {
    await db.connect();
    await db.query('DROP TABLE IF EXISTS tx_probe');
    await db.query('CREATE TABLE tx_probe (n int)');
  });

  after(async () => {
    await db.query('DROP TABLE IF EXISTS tx_probe');
    await db.disconnect();
  });

  it('rolls back every write when the callback throws', async () => {
    await assert.rejects(
      db.transaction(async (client) => {
        await client.query('INSERT INTO tx_probe VALUES (1)');
        throw new Error('boom');
      }),
      /boom/
    );

    const { rows } = await db.query('SELECT count(*)::int AS n FROM tx_probe');
    assert.equal(rows[0].n, 0);
  });

  it('keeps the original error when ROLLBACK fails, and the pool stays usable', async () => {
    await assert.rejects(
      db.transaction((client) => client.query('SELECT pg_terminate_backend(pg_backend_pid())')),
      (err) => err.code === '57P01' || /terminat/i.test(err.message)
    );

    const { rows } = await db.query('SELECT 1 AS ok');
    assert.equal(rows[0].ok, 1);
  });
});
