import { randomUUID } from 'node:crypto';

/** Reuses an upstream request id when a proxy already set one. */
export default function requestId(req, res, next) {
  const id = req.get('x-request-id') || randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
