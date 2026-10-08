import { randomUUID } from 'node:crypto';

import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { query, transaction } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { DUMMY_HASH, verifyPassword } from '../../utils/password.js';
import * as userService from '../users/user.service.js';
import {
  accessTokenTtlSeconds,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './token.service.js';

/**
 * Refresh tokens rotate: each use revokes the presented token and issues a new
 * one in the same family. Presenting a token that was already rotated means
 * two parties hold it — one of them stole it — so the whole family (that one
 * login session) is revoked and both have to log in again.
 */

const invalidRefresh = (reason) =>
  ApiError.unauthorized(`Refresh token rejected: ${reason}`, {
    userMessage: 'Phiên đăng nhập không còn hiệu lực, vui lòng đăng nhập lại',
  });

async function storeRefreshToken(db, userId, familyId) {
  const token = generateRefreshToken();
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, hashRefreshToken(token), familyId, config.jwt.refreshTtlDays]
  );
  return token;
}

async function session(user, refreshToken) {
  return {
    user,
    tokenType: 'Bearer',
    accessToken: await signAccessToken(user),
    expiresIn: accessTokenTtlSeconds,
    refreshToken,
  };
}

/** Public sign-up: always a plain user, whatever the body says. */
export async function register({ name, email, password }) {
  const user = await userService.create({ name, email, password, role: 'user' });
  return session(user, await storeRefreshToken({ query }, user.id, randomUUID()));
}

export async function login({ email, password }) {
  const found = await userService.findCredentialsByEmail(email);

  // Always pay for one scrypt run, so timing cannot tell "no such email" from
  // "wrong password", and the error says the same thing for both.
  const ok = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  if (!found?.passwordHash || !ok) {
    throw ApiError.unauthorized(`Failed login for ${email}`, { code: 'INVALID_CREDENTIALS' });
  }

  const { passwordHash: _drop, ...user } = found;
  return session(user, await storeRefreshToken({ query }, user.id, randomUUID()));
}

export async function refresh(presented) {
  const tokenHash = hashRefreshToken(presented);

  // The reuse branch must commit its revocation before the 401 goes out, so
  // the transaction returns an outcome instead of throwing.
  const outcome = await transaction(async (client) => {
    // Claim the token atomically: of two concurrent refreshes with the same
    // token, exactly one gets the row back.
    const claimed = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING user_id, family_id`,
      [tokenHash]
    );

    if (!claimed.rows.length) {
      const { rows } = await client.query(
        'SELECT family_id, revoked_at FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash]
      );
      if (rows[0]?.revoked_at) {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [rows[0].family_id]
        );
        return { error: 'reused', familyId: rows[0].family_id };
      }
      return { error: rows.length ? 'expired' : 'unknown' };
    }

    const { user_id: userId, family_id: familyId } = claimed.rows[0];
    // Re-read the user so a role change is picked up at the next refresh.
    const { rows } = await client.query(`SELECT ${userService.COLUMNS} FROM users WHERE id = $1`, [
      userId,
    ]);
    return { user: rows[0], refreshToken: await storeRefreshToken(client, userId, familyId) };
  });

  if (outcome.error === 'reused') {
    logger.warn({ familyId: outcome.familyId }, 'Refresh token reuse detected, session revoked');
  }
  if (outcome.error) throw invalidRefresh(outcome.error);

  return session(outcome.user, outcome.refreshToken);
}

/** Ends the session the token belongs to. Idempotent: an unknown token is not an error. */
export async function logout(presented) {
  await query(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)
        AND revoked_at IS NULL`,
    [hashRefreshToken(presented)]
  );
}
