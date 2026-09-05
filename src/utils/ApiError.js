/** Error carrying an HTTP status; anything else is treated as a 500. */
export default class ApiError extends Error {
  constructor(statusCode, message, { code, details, isOperational = true, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? httpCode(statusCode);
    this.details = details;
    this.isOperational = isOperational;
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
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    }[statusCode] ?? 'ERROR'
  );
}
