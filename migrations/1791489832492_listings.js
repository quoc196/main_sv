import { readFileSync } from 'node:fs';

/**
 * Rental listings: the administrative catalogue, the listings themselves and
 * what hangs off them (images, amenities, favorites, reports).
 *
 * Vietnam has had two administrative levels since 2025-07-01 — 34 provinces
 * and their wards/communes, no districts — so there is no district table.
 */

const units = JSON.parse(
  readFileSync(new URL('./data/vn-administrative-units-2025.json', import.meta.url), 'utf8')
);

const AMENITIES = [
  ['air_con', 'Điều hoà'],
  ['water_heater', 'Nóng lạnh'],
  ['private_wc', 'WC riêng'],
  ['loft', 'Gác lửng'],
  ['kitchen', 'Bếp nấu'],
  ['fridge', 'Tủ lạnh'],
  ['washing_machine', 'Máy giặt'],
  ['furnished', 'Đủ nội thất'],
  ['balcony', 'Ban công'],
  ['window', 'Cửa sổ'],
  ['elevator', 'Thang máy'],
  ['parking', 'Chỗ để xe'],
  ['camera', 'Camera an ninh'],
  ['wifi', 'Wifi'],
];

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** One INSERT per chunk keeps each statement a sane size. */
function insertRows(pgm, table, columns, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((row) => `(${row.map(literal).join(', ')})`)
      .join(',\n');
    pgm.sql(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values}`);
  }
}

export const up = (pgm) => {
  // ------------------------------------------------------------- extensions
  // cube + earthdistance give radius search with a GiST index; they ship with
  // every Postgres (PostGIS does not, and would mean a different CI image).
  // pg_trgm + unaccent make "phong tro bach khoa" match "Phòng trọ Bách Khoa".
  pgm.sql('CREATE EXTENSION IF NOT EXISTS cube');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS earthdistance');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS unaccent');

  // unaccent() is only STABLE, so it cannot sit in an index expression. This
  // wrapper pins the dictionary by schema, which makes IMMUTABLE true. The
  // schema is looked up rather than assumed: Supabase installs extensions in
  // `extensions`, a plain Postgres in `public`.
  pgm.sql(`
    DO $do$
    DECLARE ext_schema text := (
      SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'unaccent'
    );
    BEGIN
      EXECUTE format(
        $f$CREATE OR REPLACE FUNCTION public.immutable_unaccent(text) RETURNS text
           LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
           AS $body$ SELECT %1$I.unaccent(%2$L::regdictionary, $1) $body$$f$,
        ext_schema,
        ext_schema || '.unaccent'
      );
    END $do$;
  `);

  // ------------------------------------------------------------------ users
  pgm.addColumns('users', {
    // Stored normalised to 0xxxxxxxxx by the API. Required before posting a
    // listing; checked there rather than here, since most users never post.
    phone: { type: 'text', unique: true },
    // Reserved for OTP verification later.
    phone_verified_at: { type: 'timestamptz' },
    avatar_url: { type: 'text' },
  });

  // ------------------------------------------------------- administrative units
  pgm.createTable('provinces', {
    code: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
  });
  pgm.createTable('wards', {
    code: { type: 'text', primaryKey: true },
    province_code: { type: 'text', notNull: true, references: 'provinces' },
    name: { type: 'text', notNull: true },
  });
  // Target of the composite FK on listings: a listing's ward must belong to
  // its province, not just exist somewhere.
  pgm.addConstraint('wards', 'wards_province_code_code_key', {
    unique: ['province_code', 'code'],
  });

  insertRows(
    pgm,
    'provinces',
    ['code', 'name'],
    units.map((p) => [p.code, p.name])
  );
  insertRows(
    pgm,
    'wards',
    ['code', 'province_code', 'name'],
    units.flatMap((p) => p.wards.map(([code, name]) => [code, p.code, name]))
  );

  // --------------------------------------------------------------- amenities
  pgm.createTable('amenities', {
    code: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    icon_url: { type: 'text' },
    position: { type: 'smallint', notNull: true, default: 0 },
  });
  insertRows(
    pgm,
    'amenities',
    ['code', 'name', 'position'],
    AMENITIES.map(([code, name], i) => [code, name, i])
  );

  // ---------------------------------------------------------------- listings
  pgm.createTable('listings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    type: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    reject_reason: { type: 'text' },

    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },

    // VND as integer: pg hands bigint back as a string, and a month's rent
    // stays far below integer's 2.1 billion.
    price: { type: 'integer', notNull: true },
    deposit: { type: 'integer' },
    area_m2: { type: 'numeric(6,1)', notNull: true },
    max_occupants: { type: 'smallint' },

    province_code: { type: 'text', notNull: true },
    ward_code: { type: 'text', notNull: true },
    address_detail: { type: 'text', notNull: true },
    lat: { type: 'double precision', notNull: true },
    lng: { type: 'double precision', notNull: true },

    // NULL means "included in the rent".
    electricity_price: { type: 'integer' },
    water_price: { type: 'integer' },
    water_unit: { type: 'text', notNull: true, default: 'included' },
    wifi_fee: { type: 'integer' },
    parking_fee: { type: 'integer' },
    other_fees_note: { type: 'text' },

    // NULL means no curfew.
    curfew_time: { type: 'time' },
    shared_with_owner: { type: 'boolean', notNull: true, default: false },
    gender_preference: { type: 'text', notNull: true, default: 'any' },
    pets_allowed: { type: 'boolean', notNull: true, default: false },
    available_from: { type: 'date' },

    // Set when approved and pushed forward on every refresh; a listing past it
    // simply stops matching searches, so stale ads expire with no cron job.
    expires_at: { type: 'timestamptz' },
    view_count: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('listings', 'listings_ward_fkey', {
    foreignKeys: {
      columns: ['province_code', 'ward_code'],
      references: 'wards(province_code, code)',
    },
  });

  const checks = {
    type_check: "type IN ('room', 'mini_apartment', 'house', 'shared')",
    status_check: "status IN ('pending', 'active', 'rejected', 'rented', 'hidden')",
    reject_reason_check: "status <> 'rejected' OR reject_reason IS NOT NULL",
    active_expiry_check: "status <> 'active' OR expires_at IS NOT NULL",
    title_check: 'char_length(btrim(title)) BETWEEN 10 AND 150',
    price_check: 'price >= 0',
    deposit_check: 'deposit IS NULL OR deposit >= 0',
    area_check: 'area_m2 > 0',
    occupants_check: 'max_occupants IS NULL OR max_occupants > 0',
    // Vietnam's bounding box, islands included. Mostly catches lat/lng swapped.
    lat_check: 'lat BETWEEN 8 AND 24',
    lng_check: 'lng BETWEEN 102 AND 118',
    fees_check:
      '(electricity_price IS NULL OR electricity_price >= 0) AND ' +
      '(water_price IS NULL OR water_price >= 0) AND ' +
      '(wifi_fee IS NULL OR wifi_fee >= 0) AND (parking_fee IS NULL OR parking_fee >= 0)',
    water_unit_check: "water_unit IN ('m3', 'person', 'included')",
    gender_check: "gender_preference IN ('any', 'male', 'female')",
  };
  for (const [name, check] of Object.entries(checks)) {
    pgm.addConstraint('listings', `listings_${name}`, { check });
  }

  // Search only ever looks at live listings, so its indexes skip the rest.
  pgm.createIndex('listings', ['province_code', 'ward_code', 'price'], {
    name: 'listings_search_idx',
    where: "status = 'active'",
  });
  pgm.sql(
    "CREATE INDEX listings_location_idx ON listings USING gist (ll_to_earth(lat, lng)) WHERE status = 'active'"
  );
  // Free-text search covers the title and the street address: people type
  // "ta quang buu" as often as "phong tro".
  pgm.sql(
    'CREATE INDEX listings_text_trgm_idx ON listings USING gin ' +
      "(lower(public.immutable_unaccent(title || ' ' || address_detail)) gin_trgm_ops)"
  );
  pgm.createIndex('listings', [{ name: 'owner_id' }, { name: 'created_at', sort: 'DESC' }]);
  // The moderation queue: oldest pending first.
  pgm.createIndex('listings', ['status', 'created_at']);

  // ------------------------------------------------------ listing children
  pgm.createTable('listing_images', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    listing_id: { type: 'uuid', notNull: true, references: 'listings', onDelete: 'CASCADE' },
    // A path inside the bucket, not a full URL: moving to another storage
    // project then needs a config change, not a data migration.
    storage_path: { type: 'text', notNull: true },
    // Lowest position is the cover image.
    position: { type: 'smallint', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('listing_images', ['listing_id', 'position']);

  pgm.createTable('listing_amenities', {
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'CASCADE',
      primaryKey: true,
    },
    amenity_code: { type: 'text', notNull: true, references: 'amenities', primaryKey: true },
  });
  // "Has air con": find listings by amenity, the opposite way round to the PK.
  pgm.createIndex('listing_amenities', ['amenity_code', 'listing_id']);

  pgm.createTable('favorites', {
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
      primaryKey: true,
    },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'CASCADE',
      primaryKey: true,
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Serves the ON DELETE CASCADE from listings, which would otherwise scan.
  pgm.createIndex('favorites', 'listing_id');

  pgm.createTable('reports', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    listing_id: { type: 'uuid', notNull: true, references: 'listings', onDelete: 'CASCADE' },
    reporter_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    reason: { type: 'text', notNull: true },
    note: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'open' },
    resolved_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    resolved_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('reports', 'reports_reason_check', {
    check: "reason IN ('scam', 'wrong_info', 'already_rented', 'duplicate', 'other')",
  });
  pgm.addConstraint('reports', 'reports_status_check', {
    check: "status IN ('open', 'resolved', 'dismissed')",
  });
  // One report per person per listing: a grudge is one report, not fifty.
  pgm.addConstraint('reports', 'reports_listing_reporter_key', {
    unique: ['listing_id', 'reporter_id'],
  });
  pgm.createIndex('reports', ['status', 'created_at']);
};

export const down = (pgm) => {
  pgm.dropTable('reports');
  pgm.dropTable('favorites');
  pgm.dropTable('listing_amenities');
  pgm.dropTable('listing_images');
  pgm.dropTable('listings');
  pgm.dropTable('amenities');
  pgm.dropTable('wards');
  pgm.dropTable('provinces');
  pgm.dropColumns('users', ['phone', 'phone_verified_at', 'avatar_url']);
  pgm.sql('DROP FUNCTION IF EXISTS public.immutable_unaccent(text)');
  // Extensions stay: on Supabase they may have been enabled before this
  // migration, and other objects may depend on them.
};
