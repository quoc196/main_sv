import pino from 'pino';
import config from './index.js';

const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.newPassword',
    'res.headers["set-cookie"]',
  ],
  censor: '[redacted]',
};

const logger = pino({
  level: config.isTest ? 'silent' : config.log.level,
  base: { app: config.app.name, env: config.env },
  redact,
  transport: config.log.pretty
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,app,env' },
      }
    : undefined,
});

export default logger;
