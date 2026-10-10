import { query, transaction } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';

const UNIQUE_VIOLATION = '23505';

export async function create(listingId, user, { reason, note }) {
  const { rows } = await query('SELECT owner_id FROM listings WHERE id = $1', [listingId]);
  if (!rows.length) {
    throw ApiError.notFound(`Listing ${listingId} not found`, {
      userMessage: 'Không tìm thấy tin đăng',
    });
  }
  if (rows[0].owner_id === user.id) {
    throw ApiError.badRequest('Cannot report your own listing', {
      userMessage: 'Không thể báo cáo tin của chính bạn',
    });
  }

  try {
    await query(
      'INSERT INTO reports (listing_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4)',
      [listingId, user.id, reason, note ?? null]
    );
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.conflict(`User ${user.id} already reported ${listingId}`, {
        userMessage: 'Bạn đã báo cáo tin này rồi',
        cause: err,
      });
    }
    throw err;
  }
}

export async function list({ status, page, limit }) {
  const [items, counted] = await Promise.all([
    query(
      `SELECT r.id, r.reason, r.note, r.status, r.created_at AS "createdAt",
              r.resolved_at AS "resolvedAt",
              json_build_object('id', l.id, 'title', l.title, 'status', l.status) AS listing,
              json_build_object('id', u.id, 'name', u.name, 'email', u.email) AS reporter
         FROM reports r
         JOIN listings l ON l.id = r.listing_id
         JOIN users u ON u.id = r.reporter_id
        WHERE r.status = $1
        ORDER BY r.created_at ASC, r.id
        LIMIT $2 OFFSET $3`,
      [status, limit, (page - 1) * limit]
    ),
    query('SELECT count(*)::int AS total FROM reports WHERE status = $1', [status]),
  ]);
  return { items: items.rows, total: counted.rows[0].total };
}

/** Closes a report; `hideListing` takes the listing down in the same step. */
export async function resolve(id, admin, { status, hideListing }) {
  await transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now()
        WHERE id = $1 AND status = 'open'
        RETURNING listing_id`,
      [id, status, admin.id]
    );
    if (!rows.length) {
      throw ApiError.notFound(`Open report ${id} not found`, {
        userMessage: 'Không tìm thấy báo cáo đang mở',
      });
    }
    if (hideListing) {
      await client.query(
        `UPDATE listings SET status = 'hidden', updated_at = now()
          WHERE id = $1 AND status = 'active'`,
        [rows[0].listing_id]
      );
    }
  });
}
