import { randomUUID } from 'node:crypto';

/**
 * An upstream proxy may already have tagged the request, and reusing its id
 * keeps one trace across hops. But the header is client-controlled: it lands in
 * every log line and goes back out in the response, so an id from outside is
 * only reused when it is short and boring — anything else gets a fresh UUID.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export default function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
