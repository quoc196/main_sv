import { success } from '../utils/response.js';

/**
 * Attaches the response helpers to res — the same way pino-http attaches
 * req.log — so a controller never hand-builds the envelope and no endpoint can
 * drift into its own shape.
 */
export default function response(_req, res, next) {
  res.ok = (data, { message, meta } = {}) => res.status(200).json(success({ data, message, meta }));

  res.created = (data, { message } = {}) => res.status(201).json(success({ data, message }));

  res.noContent = () => res.status(204).end();

  res.paginated = (items, { page, limit, total }, { message } = {}) =>
    res.status(200).json(
      success({
        data: items,
        message,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    );

  next();
}
