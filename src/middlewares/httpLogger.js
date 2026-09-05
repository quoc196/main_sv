import pinoHttp from 'pino-http';
import logger from '../config/logger.js';

export default pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.originalUrl ?? req.url} ${res.statusCode}`;
  },
  autoLogging: {
    ignore: (req) => (req.originalUrl ?? req.url).startsWith('/health'),
  },
});
