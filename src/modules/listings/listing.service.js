import config from '../../config/index.js';
import { query, transaction } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import * as storage from '../../utils/storage.js';

/**
 * Listings: search, detail, the owner's own lifecycle, and moderation.
 *
 * Status flow
 *   pending --approve--> active --owner--> rented | hidden --owner--> active
 *      ^                   |  \--admin--> rejected | hidden
 *      +---- any edit -----+
 *
 * Every content edit sends a listing back to `pending`: approval vouches for
 * what was reviewed, and a scammer would otherwise get approved with honest
 * photos and swap them afterwards.
 */

const FOREIGN_KEY_VIOLATION = '23503';

const notFound = (id) =>
  ApiError.notFound(`Listing ${id} not found`, { userMessage: 'Không tìm thấy tin đăng' });

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

/**
 * The "real monthly cost" shown next to the rent: electricity at 100 kWh and
 * water at 4 m³ (or one person) — a typical single tenant. Rough on purpose;
 * it exists so a cheap rent with expensive extras cannot hide.
 */
const ESTIMATED_KWH = 100;
const ESTIMATED_WATER_M3 = 4;
const MONTHLY_COST = `(
  l.price::bigint
  + COALESCE(l.electricity_price, 0)::bigint * ${ESTIMATED_KWH}
  + CASE l.water_unit
      WHEN 'm3' THEN COALESCE(l.water_price, 0)::bigint * ${ESTIMATED_WATER_M3}
      WHEN 'person' THEN COALESCE(l.water_price, 0)::bigint
      ELSE 0
    END
  + COALESCE(l.wifi_fee, 0) + COALESCE(l.parking_fee, 0)
)::float8`;

// What a search result card needs. numeric comes back from pg as a string,
// hence the float8 casts.
const SUMMARY_COLUMNS = `
  l.id, l.type, l.status, l.title, l.price,
  l.area_m2::float8 AS "areaM2",
  ${MONTHLY_COST} AS "estimatedMonthlyCost",
  l.address_detail AS "addressDetail",
  l.ward_code AS "wardCode", w.name AS "wardName",
  l.province_code AS "provinceCode", p.name AS "provinceName",
  l.lat, l.lng,
  l.expires_at AS "expiresAt", l.created_at AS "createdAt",
  (SELECT i.storage_path FROM listing_images i
    WHERE i.listing_id = l.id ORDER BY i.position LIMIT 1) AS "coverPath"`;

const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},
  l.owner_id AS "ownerId", l.reject_reason AS "rejectReason",
  l.description, l.deposit, l.max_occupants AS "maxOccupants",
  l.electricity_price AS "electricityPrice", l.water_price AS "waterPrice",
  l.water_unit AS "waterUnit", l.wifi_fee AS "wifiFee", l.parking_fee AS "parkingFee",
  l.other_fees_note AS "otherFeesNote",
  to_char(l.curfew_time, 'HH24:MI') AS "curfewTime",
  l.shared_with_owner AS "sharedWithOwner", l.gender_preference AS "genderPreference",
  l.pets_allowed AS "petsAllowed",
  to_char(l.available_from, 'YYYY-MM-DD') AS "availableFrom",
  l.view_count AS "viewCount", l.updated_at AS "updatedAt"`;

const FROM = `
  FROM listings l
  JOIN wards w ON w.code = l.ward_code
  JOIN provinces p ON p.code = l.province_code`;

/** Live = visible to the public. */
const LIVE = "l.status = 'active' AND l.expires_at > now()";

function toSummary({ coverPath, ...row }) {
  return { ...row, coverImageUrl: storage.publicUrl(coverPath) };
}

// API field -> column, for the fields an owner writes.
const WRITABLE = {
  type: 'type',
  title: 'title',
  description: 'description',
  price: 'price',
  deposit: 'deposit',
  areaM2: 'area_m2',
  maxOccupants: 'max_occupants',
  wardCode: 'ward_code',
  addressDetail: 'address_detail',
  lat: 'lat',
  lng: 'lng',
  electricityPrice: 'electricity_price',
  waterPrice: 'water_price',
  waterUnit: 'water_unit',
  wifiFee: 'wifi_fee',
  parkingFee: 'parking_fee',
  otherFeesNote: 'other_fees_note',
  curfewTime: 'curfew_time',
  sharedWithOwner: 'shared_with_owner',
  genderPreference: 'gender_preference',
  petsAllowed: 'pets_allowed',
  availableFrom: 'available_from',
};

const ttl = () => `now() + make_interval(days => ${Number(config.listings.ttlDays)})`;

/** Turns DB rejections of client input into 400s instead of 500s. */
function mapWriteError(err) {
  if (err.code === FOREIGN_KEY_VIOLATION) {
    return ApiError.badRequest(`Invalid reference: ${err.detail}`, {
      userMessage: 'Phường/xã hoặc tiện ích không hợp lệ',
      cause: err,
    });
  }
  return err;
}

async function provinceOf(client, wardCode) {
  const { rows } = await client.query('SELECT province_code FROM wards WHERE code = $1', [
    wardCode,
  ]);
  if (!rows.length) {
    throw ApiError.badRequest(`Ward ${wardCode} not found`, {
      userMessage: 'Phường/xã không hợp lệ',
    });
  }
  return rows[0].province_code;
}

async function replaceAmenities(client, listingId, codes) {
  await client.query('DELETE FROM listing_amenities WHERE listing_id = $1', [listingId]);
  if (codes.length) {
    await client.query(
      `INSERT INTO listing_amenities (listing_id, amenity_code)
       SELECT $1, unnest($2::text[])`,
      [listingId, codes]
    );
  }
}

/** Locks the row and checks the caller owns it; anyone else gets a plain 404. */
async function lockOwned(client, id, user) {
  const { rows } = await client.query(
    'SELECT owner_id, status, expires_at FROM listings WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!rows.length || rows[0].owner_id !== user.id) throw notFound(id);
  return rows[0];
}

// ------------------------------------------------------------------ search

const SORTS = {
  // A refresh pushes expires_at forward, so "newest" means "most recently
  // approved or refreshed" — what a tenant scanning for fresh ads wants.
  newest: 'l.expires_at DESC, l.id DESC',
  price_asc: 'l.price ASC, l.id',
  price_desc: 'l.price DESC, l.id',
  distance: '"distanceM" ASC, l.id',
};

export async function search(f) {
  const where = [LIVE];
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (f.q) {
    where.push(
      `lower(public.immutable_unaccent(l.title || ' ' || l.address_detail))
         LIKE lower(public.immutable_unaccent(${param(`%${escapeLike(f.q)}%`)}))`
    );
  }
  if (f.province) where.push(`l.province_code = ${param(f.province)}`);
  if (f.ward) where.push(`l.ward_code = ${param(f.ward)}`);
  if (f.type) where.push(`l.type = ${param(f.type)}`);
  if (f.minPrice !== undefined) where.push(`l.price >= ${param(f.minPrice)}`);
  if (f.maxPrice !== undefined) where.push(`l.price <= ${param(f.maxPrice)}`);
  if (f.minArea !== undefined) where.push(`l.area_m2 >= ${param(f.minArea)}`);
  if (f.gender) where.push(`l.gender_preference IN ('any', ${param(f.gender)})`);
  if (f.pets) where.push('l.pets_allowed');
  if (f.amenities?.length) {
    // Must have every requested amenity, not any of them.
    where.push(
      `(SELECT count(*) FROM listing_amenities la
         WHERE la.listing_id = l.id AND la.amenity_code = ANY(${param(f.amenities)}::text[])
       ) = ${f.amenities.length}`
    );
  }

  let distance = 'NULL::int';
  if (f.lat !== undefined) {
    const origin = `ll_to_earth(${param(f.lat)}, ${param(f.lng)})`;
    const radius = param(f.radiusKm * 1000);
    // earth_box is the indexable bounding box; earth_distance trims its corners.
    where.push(
      `earth_box(${origin}, ${radius}) @> ll_to_earth(l.lat, l.lng)`,
      `earth_distance(${origin}, ll_to_earth(l.lat, l.lng)) <= ${radius}`
    );
    distance = `round(earth_distance(${origin}, ll_to_earth(l.lat, l.lng)))::int`;
  }

  const whereSql = where.join('\n    AND ');
  const countParams = [...params];
  const limit = param(f.limit);
  const offset = param((f.page - 1) * f.limit);

  const [items, counted] = await Promise.all([
    query(
      `SELECT ${SUMMARY_COLUMNS}, ${distance} AS "distanceM"
       ${FROM}
       WHERE ${whereSql}
       ORDER BY ${SORTS[f.sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    query(`SELECT count(*)::int AS total FROM listings l WHERE ${whereSql}`, countParams),
  ]);

  return { items: items.rows.map(toSummary), total: counted.rows[0].total };
}

// ------------------------------------------------------------------ detail

/**
 * A live listing is public. Anything else (pending, rejected, hidden, expired)
 * is visible only to its owner and to admins; everyone else gets a 404 so the
 * listing's existence does not leak.
 *
 * `countView` is set only by the public detail endpoint: the same read also
 * answers an owner's edit or an admin's approval, which are not views.
 */
export async function getById(id, viewer, { countView = false } = {}) {
  const { rows } = await query(
    `SELECT ${DETAIL_COLUMNS}, (${LIVE}) AS live,
            u.name AS "ownerName", u.phone AS "ownerPhone", u.avatar_url AS "ownerAvatarUrl"
     ${FROM}
     JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1`,
    [id]
  );
  const row = rows[0];
  const isOwner = row && viewer?.id === row.ownerId;
  if (!row || !(row.live || isOwner || viewer?.role === 'admin')) throw notFound(id);

  const [images, amenities] = await Promise.all([
    query(
      'SELECT id, storage_path, position FROM listing_images WHERE listing_id = $1 ORDER BY position',
      [id]
    ),
    query(
      `SELECT a.code, a.name, a.icon_url AS "iconUrl"
         FROM listing_amenities la JOIN amenities a ON a.code = la.amenity_code
        WHERE la.listing_id = $1
        ORDER BY a.position`,
      [id]
    ),
  ]);

  if (countView && row.live && !isOwner) {
    await query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [id]);
  }

  const { live: _live, ownerId, ownerName, ownerPhone, ownerAvatarUrl, ...listing } = row;
  return {
    ...toSummary(listing),
    images: images.rows.map((i) => ({
      id: i.id,
      url: storage.publicUrl(i.storage_path),
      position: i.position,
    })),
    amenities: amenities.rows,
    owner: { id: ownerId, name: ownerName, phone: ownerPhone, avatarUrl: ownerAvatarUrl },
  };
}

// ------------------------------------------------------------ owner actions

export async function create(user, body) {
  const { rows: owner } = await query('SELECT phone FROM users WHERE id = $1', [user.id]);
  if (!owner.length) throw ApiError.unauthorized(`User ${user.id} no longer exists`);
  // The phone is how tenants reach the owner; a listing without one is a dead end.
  if (!owner[0].phone) {
    throw new ApiError(422, `User ${user.id} has no phone number`, {
      userMessage: 'Vui lòng cập nhật số điện thoại trước khi đăng tin',
    });
  }

  let id;
  try {
    id = await transaction(async (client) => {
      const provinceCode = await provinceOf(client, body.wardCode);
      const entries = Object.entries(WRITABLE).filter(([field]) => body[field] !== undefined);
      const columns = ['owner_id', 'province_code', ...entries.map(([, column]) => column)];
      const values = [user.id, provinceCode, ...entries.map(([field]) => body[field])];

      const { rows } = await client.query(
        `INSERT INTO listings (${columns.join(', ')})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING id`,
        values
      );
      await replaceAmenities(client, rows[0].id, body.amenities);
      return rows[0].id;
    });
  } catch (err) {
    throw mapWriteError(err);
  }
  return getById(id, user);
}

export async function update(id, user, patch) {
  try {
    await transaction(async (client) => {
      await lockOwned(client, id, user);

      const sets = [];
      const params = [id];
      const set = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      for (const [field, column] of Object.entries(WRITABLE)) {
        if (patch[field] !== undefined) set(column, patch[field]);
      }
      if (patch.wardCode !== undefined) {
        set('province_code', await provinceOf(client, patch.wardCode));
      }

      await client.query(
        `UPDATE listings
            SET ${[...sets, "status = 'pending'", 'reject_reason = NULL', 'updated_at = now()'].join(', ')}
          WHERE id = $1`,
        params
      );
      if (patch.amenities !== undefined) await replaceAmenities(client, id, patch.amenities);
    });
  } catch (err) {
    throw mapWriteError(err);
  }
  return getById(id, user);
}

// Owner-driven transitions. Approval itself is an admin action.
const OWNER_TRANSITIONS = {
  active: ['rented', 'hidden'],
  rented: ['active', 'hidden'],
  hidden: ['active', 'rented'],
};

export async function setStatus(id, user, status) {
  await transaction(async (client) => {
    const current = await lockOwned(client, id, user);
    if (!OWNER_TRANSITIONS[current.status]?.includes(status)) {
      throw ApiError.conflict(`Cannot move listing ${id} from ${current.status} to ${status}`, {
        userMessage: 'Không thể chuyển tin sang trạng thái này',
      });
    }
    // Coming back live counts as fresh: otherwise a listing hidden for a
    // month would reappear already expired.
    await client.query(
      `UPDATE listings
          SET status = $2, updated_at = now()${status === 'active' ? `, expires_at = ${ttl()}` : ''}
        WHERE id = $1`,
      [id, status]
    );
  });
  return getById(id, user);
}

/**
 * Pushes the expiry forward. Once a day at most: "newest" sorts on the
 * expiry, so unlimited refreshes would let one owner sit on top of every search.
 */
export async function refresh(id, user) {
  await transaction(async (client) => {
    const current = await lockOwned(client, id, user);
    if (current.status !== 'active') {
      throw ApiError.conflict(`Listing ${id} is ${current.status}`, {
        userMessage: 'Chỉ làm mới được tin đang hiển thị',
      });
    }
    const { rowCount } = await client.query(
      `UPDATE listings SET expires_at = ${ttl()}
        WHERE id = $1 AND expires_at <= ${ttl()} - interval '1 day'`,
      [id]
    );
    if (!rowCount) {
      throw ApiError.conflict(`Listing ${id} was refreshed less than a day ago`, {
        userMessage: 'Mỗi tin chỉ làm mới được 1 lần trong 24 giờ',
      });
    }
  });
  return getById(id, user);
}

export async function remove(id, user) {
  const paths = await transaction(async (client) => {
    const { rows } = await client.query('SELECT owner_id FROM listings WHERE id = $1 FOR UPDATE', [
      id,
    ]);
    if (!rows.length || (rows[0].owner_id !== user.id && user.role !== 'admin')) {
      throw notFound(id);
    }
    const images = await client.query(
      'SELECT storage_path FROM listing_images WHERE listing_id = $1',
      [id]
    );
    await client.query('DELETE FROM listings WHERE id = $1', [id]);
    return images.rows.map((r) => r.storage_path);
  });
  // After the commit: a storage failure must not resurrect the listing.
  await storage.remove(paths);
}

/**
 * One paginated summary list, shared by "my listings", favorites and the
 * moderation queue. `where` / `join` are fixed SQL from this module; every
 * caller-supplied value goes through `params`.
 */
export async function listSummaries({
  join = '',
  where,
  params,
  extraColumns,
  order,
  page,
  limit,
}) {
  const n = params.length;
  const [items, counted] = await Promise.all([
    query(
      `SELECT ${SUMMARY_COLUMNS}${extraColumns ? `, ${extraColumns}` : ''}
       ${FROM}
       ${join}
       WHERE ${where}
       ORDER BY ${order}
       LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
    query(`SELECT count(*)::int AS total FROM listings l ${join} WHERE ${where}`, params),
  ]);
  return { items: items.rows.map(toSummary), total: counted.rows[0].total };
}

export function listMine(user, { status, page, limit }) {
  return listSummaries({
    where: 'l.owner_id = $1 AND ($2::text IS NULL OR l.status = $2)',
    params: [user.id, status ?? null],
    extraColumns: 'l.reject_reason AS "rejectReason", l.view_count AS "viewCount"',
    order: 'l.created_at DESC, l.id DESC',
    page,
    limit,
  });
}

// -------------------------------------------------------------- moderation

export function moderationQueue({ status, page, limit }) {
  return listSummaries({
    join: 'JOIN users u ON u.id = l.owner_id',
    where: 'l.status = $1',
    params: [status],
    extraColumns:
      'l.reject_reason AS "rejectReason", ' +
      "json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'phone', u.phone) AS owner",
    // Pending is a queue, so oldest first; other statuses are browsed newest first.
    order: status === 'pending' ? 'l.created_at ASC, l.id' : 'l.updated_at DESC, l.id',
    page,
    limit,
  });
}

const MODERATION = {
  approve: {
    from: ['pending'],
    set: `status = 'active', reject_reason = NULL, expires_at = ${ttl()}`,
  },
  reject: { from: ['pending', 'active'], set: "status = 'rejected', reject_reason = $2" },
  hide: { from: ['active'], set: "status = 'hidden'" },
};

export async function moderate(id, admin, { action, reason }) {
  const rule = MODERATION[action];
  const params = action === 'reject' ? [id, reason] : [id];
  const { rowCount } = await query(
    `UPDATE listings SET ${rule.set}, updated_at = now()
      WHERE id = $1 AND status = ANY(${`$${params.length + 1}`}::text[])`,
    [...params, rule.from]
  );
  if (!rowCount) {
    const { rows } = await query('SELECT status FROM listings WHERE id = $1', [id]);
    if (!rows.length) throw notFound(id);
    throw ApiError.conflict(`Cannot ${action} a ${rows[0].status} listing`, {
      userMessage: 'Trạng thái tin không cho phép thao tác này',
    });
  }
  return getById(id, admin);
}
