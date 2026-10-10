import { query, transaction } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { hashPassword } from '../../utils/password.js';

/**
 * The repository for `users`. Controllers depend on these signatures, not on
 * how the rows are fetched, so this is the only file that knows any SQL.
 */

/** Postgres raises this when a UNIQUE constraint rejects a row. */
const UNIQUE_VIOLATION = '23505';

// snake_case in the database, camelCase on the wire — aliased once, here.
// password_hash is deliberately absent: nothing selected through COLUMNS can
// leak it into a response.
export const COLUMNS =
  'id, name, email, role, phone, avatar_url AS "avatarUrl", ' +
  'created_at AS "createdAt", updated_at AS "updatedAt"';

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

/** For login only: the one read that returns the hash, kept out of COLUMNS. */
export async function findCredentialsByEmail(email) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, password_hash AS "passwordHash" FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function create({ name, email, password, role = 'user' }) {
  const passwordHash = password ? await hashPassword(password) : null;
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [name, email, passwordHash, role]
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
  const passwordHash = patch.password ? await hashPassword(patch.password) : null;
  try {
    // COALESCE keeps this one static statement for any subset of fields. None
    // of them can be cleared to NULL through the API, so nothing is lost.
    // A new password also ends every session the user has: whoever knew the
    // old one must not keep a refresh token that outlives the change.
    const { rows } = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE users
            SET name = COALESCE($2, name),
                email = COALESCE($3, email),
                password_hash = COALESCE($4, password_hash),
                role = COALESCE($5, role),
                updated_at = now()
          WHERE id = $1
        RETURNING ${COLUMNS}`,
        [id, patch.name ?? null, patch.email ?? null, passwordHash, patch.role ?? null]
      );
      if (result.rows.length && passwordHash) {
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [id]
        );
      }
      return result;
    });

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

/**
 * A user editing their own profile. `phone: null` clears it; any change to the
 * number drops its verification, since the old proof was for another number.
 */
export async function updateProfile(id, patch) {
  const sets = [];
  const params = [id];
  const set = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.name !== undefined) set('name', patch.name);
  if (patch.avatarUrl !== undefined) set('avatar_url', patch.avatarUrl);
  if (patch.phone !== undefined) {
    set('phone', patch.phone);
    sets.push(
      'phone_verified_at = CASE WHEN phone IS DISTINCT FROM $' +
        params.length +
        ' THEN NULL ELSE phone_verified_at END'
    );
  }

  try {
    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      params
    );
    if (!rows.length) {
      throw ApiError.notFound(`User ${id} not found`, { userMessage: 'Không tìm thấy user' });
    }
    return rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.conflict(`Phone ${patch.phone} is already taken`, {
        userMessage: 'Số điện thoại này đã được sử dụng',
        cause: err,
      });
    }
    throw err;
  }
}
