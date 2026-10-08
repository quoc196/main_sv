import { query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * The repository for `users`. Controllers depend on these signatures, not on
 * how the rows are fetched, so this is the only file that knows any SQL.
 */

/** Postgres raises this when a UNIQUE constraint rejects a row. */
const UNIQUE_VIOLATION = '23505';

// snake_case in the database, camelCase on the wire — aliased once, here.
const COLUMNS = 'id, name, email, created_at AS "createdAt", updated_at AS "updatedAt"';

/**
 * `%` and `_` are ILIKE wildcards, so a search for "a_b" would otherwise match
 * "axb". Escaping them keeps the query literal, which is what a user typing in
 * a search box expects.
 */
const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

/**
 * A leading `%` means no index can serve this; it is fine at demo scale. For a
 * real table, add pg_trgm and a GIN index on (name, email) instead.
 */
const SEARCH_FILTER = '($1::text IS NULL OR name ILIKE $1 OR email ILIKE $1)';

export async function list({ page, limit, q }) {
  const pattern = q ? `%${escapeLike(q)}%` : null;

  // Ordered by (created_at, id) so the sort is total: without the id tiebreak,
  // rows sharing a timestamp could repeat or vanish across pages.
  const [items, counted] = await Promise.all([
    query(
      `SELECT ${COLUMNS}
         FROM users
        WHERE ${SEARCH_FILTER}
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [pattern, limit, (page - 1) * limit]
    ),
    query(`SELECT count(*)::int AS total FROM users WHERE ${SEARCH_FILTER}`, [pattern]),
  ]);

  return { items: items.rows, total: counted.rows[0].total };
}

export async function getById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);

  if (!rows.length) {
    throw ApiError.notFound(`User ${id} not found`, { userMessage: 'Không tìm thấy user' });
  }
  return rows[0];
}

export async function create({ name, email }) {
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [name, email]
    );
    return rows[0];
  } catch (err) {
    // Let the constraint decide, rather than checking first: a SELECT-then-
    // INSERT lets two concurrent signups with the same email both get through.
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.conflict(`Email ${email} is already taken`, {
        userMessage: 'Email này đã được sử dụng',
        cause: err,
      });
    }
    throw err;
  }
}

export async function update(id, patch) {
  try {
    // COALESCE keeps this one static statement for any subset of fields.
    // Neither column is nullable, so there is no "set it to NULL" case to lose.
    const { rows } = await query(
      `UPDATE users
          SET name = COALESCE($2, name),
              email = COALESCE($3, email),
              updated_at = now()
        WHERE id = $1
      RETURNING ${COLUMNS}`,
      [id, patch.name ?? null, patch.email ?? null]
    );

    if (!rows.length) {
      throw ApiError.notFound(`User ${id} not found`, { userMessage: 'Không tìm thấy user' });
    }
    return rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.conflict(`Email ${patch.email} is already taken`, {
        userMessage: 'Email này đã được sử dụng',
        cause: err,
      });
    }
    throw err;
  }
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);

  if (!rowCount) {
    throw ApiError.notFound(`User ${id} not found`, { userMessage: 'Không tìm thấy user' });
  }
}
