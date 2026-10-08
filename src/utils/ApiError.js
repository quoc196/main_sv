/**
 * Error carrying an HTTP status; anything else is treated as a 500.
 *
 * `message` is written for whoever reads the logs, so it can name ids, emails
 * and internals freely. `userMessage` is the only thing allowed on the wire —
 * the frontend shows it verbatim per `err_show_type`, so leave it out and the
 * response falls back to the neutral copy in CODES.
 */
export default class ApiError extends Error {
  constructor(
    statusCode,
    message,
    { code, details, isOperational = true, cause, userMessage } = {}
  ) {
    super(message, { cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? httpCode(statusCode);
    this.details = details;
    this.isOperational = isOperational;
    this.userMessage = userMessage;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Unauthorized', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'Forbidden', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Conflict', options) {
    return new ApiError(409, message, options);
  }

  static internal(message = 'Internal server error', options) {
    return new ApiError(500, message, { isOperational: false, ...options });
  }
}

function httpCode(statusCode) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    }[statusCode] ??
    // An unlisted 4xx (415, 405, ...) is still the caller's mistake; falling
    // through to ERROR would show them "the system is down".
    (statusCode < 500 ? 'BAD_REQUEST' : 'ERROR')
  );
}
