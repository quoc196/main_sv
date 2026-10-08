import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, errors, jwtVerify } from 'jose';

import config from '../../config/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Access tokens are stateless JWTs: checked on every request without touching
 * the database, which is also why they cannot be revoked and are kept short.
 * Refresh tokens are the opposite — opaque, stored, and revocable.
 */
const key = new TextEncoder().encode(config.jwt.secret);
const ALG = 'HS256';
// APP_NAME differs per environment, so a staging token is refused by
// production even if the two ever ended up sharing a secret.
const ISSUER = config.app.name;

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

/** JWT_EXPIRES_IN in seconds, handed to the client so it can refresh ahead of expiry. */
export const accessTokenTtlSeconds = (() => {
  const [, amount, unit] = config.jwt.expiresIn.match(/^(\d+)([smhd])$/);
  return Number(amount) * UNIT_SECONDS[unit];
})();

export function signAccessToken(user) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${accessTokenTtlSeconds}s`)
    .sign(key);
}

/** Resolves to `{ id, role }`, or throws a 401 the error handler understands. */
export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: [ALG] });
    return { id: payload.sub, role: payload.role };
  } catch (err) {
    // Expired is the one case the frontend should recover from on its own
    // (refresh and retry), so it gets a code of its own.
    if (err instanceof errors.JWTExpired) {
      throw ApiError.unauthorized('Access token expired', { code: 'TOKEN_EXPIRED', cause: err });
    }
    throw ApiError.unauthorized(`Invalid access token: ${err.code ?? err.message}`, { cause: err });
  }
}

export const generateRefreshToken = () => randomBytes(32).toString('base64url');

/**
 * A plain SHA-256 is enough here, unlike passwords: the token is 256 random
 * bits, so there is nothing to brute-force and no need for a slow hash.
 */
export const hashRefreshToken = (token) => createHash('sha256').update(token).digest('hex');
