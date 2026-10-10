import { query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import { listSummaries } from './listing.service.js';

/** Idempotent: saving twice is still saved once. Only live listings can be saved. */
export async function add(listingId, user) {
  const { rowCount } = await query(
    `INSERT INTO favorites (user_id, listing_id)
     SELECT $1, l.id FROM listings l
      WHERE l.id = $2 AND l.status = 'active' AND l.expires_at > now()
     ON CONFLICT DO NOTHING`,
    [user.id, listingId]
  );
  if (!rowCount) {
    const { rows } = await query('SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2', [
      user.id,
      listingId,
    ]);
    if (!rows.length) {
      throw ApiError.notFound(`Listing ${listingId} not found`, {
        userMessage: 'Không tìm thấy tin đăng',
      });
    }
  }
}

export async function remove(listingId, user) {
  await query('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [user.id, listingId]);
}

/**
 * Saved listings that later got rented or expired stay in the list, with
 * their status, so the user sees why one vanished from search.
 */
export function list(user, { page, limit }) {
  return listSummaries({
    join: 'JOIN favorites f ON f.listing_id = l.id',
    where: 'f.user_id = $1',
    params: [user.id],
    extraColumns: 'f.created_at AS "savedAt"',
    order: 'f.created_at DESC, l.id',
    page,
    limit,
  });
}
