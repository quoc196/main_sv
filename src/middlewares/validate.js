/**
 * Validates and REPLACES the request parts with the parsed output, so handlers
 * receive coerced values (numbers, defaults) instead of raw strings.
 *
 * Express 5 makes req.query a getter, so it is assigned to req.validatedQuery.
 */
export default function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };
}
