import { verifyAccessToken } from '../modules/auth/token.service.js';
import ApiError from '../utils/ApiError.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Sets `req.user = { id, role }` from the access token. No database lookup: a
 * role change or a deleted account takes effect when the token expires
 * (JWT_EXPIRES_IN), which is the trade-off for a stateless check.
 */
export async function requireAuth(req, _res, next) {
  const match = BEARER.exec(req.get('authorization') ?? '');
  if (!match) return next(ApiError.unauthorized('Missing bearer token'));

  try {
    req.user = await verifyAccessToken(match[1]);
    next();
  } catch (err) {
    next(err);
  }
}

/** Must run after requireAuth. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (roles.includes(req.user?.role)) return next();
    next(ApiError.forbidden(`Role "${req.user?.role}" is not one of: ${roles.join(', ')}`));
  };
}

/**
 * For routes that serve everyone but show more to some callers (an owner
 * seeing their own pending listing). No header: anonymous. A header that is
 * present but bad still fails, so an expired token gets code 12 and the
 * client refreshes instead of silently browsing logged-out.
 */
export function optionalAuth(req, res, next) {
  if (!req.get('authorization')) return next();
  return requireAuth(req, res, next);
}
