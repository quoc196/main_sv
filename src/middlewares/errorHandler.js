import { ZodError } from 'zod';
import config from '../config/index.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.badRequest('Validation failed', {
      code: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      cause: err,
    });
  }

  // Body-parser rejects malformed JSON with a status already attached.
  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON body', { cause: err });
  }

  const statusCode = Number.isInteger(err.status ?? err.statusCode)
    ? (err.status ?? err.statusCode)
    : 500;

  return new ApiError(statusCode, err.message || 'Internal server error', {
    isOperational: statusCode < 500,
    cause: err,
  });
}

// Express identifies error handlers by arity, so _next must stay in the signature.
export default function errorHandler(err, req, res, _next) {
  const error = normalize(err);

  const log = req.log ?? logger;
  const payload = { err: error.cause ?? error, statusCode: error.statusCode, requestId: req.id };
  if (error.statusCode >= 500) log.error(payload, error.message);
  else log.warn(payload, error.message);

  // Internal failures must never leak their message outside development.
  const exposeMessage = error.statusCode < 500 || config.isDevelopment;

  res.status(error.statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: exposeMessage ? error.message : 'Internal server error',
      ...(error.details ? { details: error.details } : {}),
      ...(config.isDevelopment && error.stack ? { stack: error.stack.split('\n') } : {}),
    },
    requestId: req.id,
  });
}
