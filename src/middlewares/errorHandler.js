import { ZodError } from 'zod';
import config from '../config/index.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';
import { failure } from '../utils/response.js';

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

  // The status line is already on the wire (a stream broke mid-response, or
  // something answered twice), so there is no way to turn this into a JSON
  // error. Cut the socket: a truncated body tells the client it went wrong,
  // while res.json() here would only throw ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    res.destroy(error);
    return;
  }

  // Anything not explicitly marked user-facing falls back to the neutral copy
  // in CODES: a message written for a developer must never reach an end user,
  // whose frontend is about to display it verbatim. Development is the one
  // exception — the real message beats the polished one while debugging.
  const message = error.userMessage ?? (config.isDevelopment ? error.message : undefined);

  res.status(error.statusCode).json(
    failure(error.code, {
      message,
      details: error.details,
      requestId: req.id,
      stack: config.isDevelopment && error.stack ? error.stack.split('\n') : undefined,
    })
  );
}
