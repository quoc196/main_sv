/**
 * The constraints here deliberately repeat what Zod already checks in
 * user.validation.js. Zod guards the HTTP boundary; these guard the data
 * itself, and they still hold for a migration, a script or a psql session that
 * never passes through Express.
 */

export const up = (pgm) => {
  pgm.createTable('users', {
    // gen_random_uuid() is core Postgres from 13 on, so no extension needed.
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    // Stored already lower-cased and trimmed by the Zod schema, so a plain
    // unique index is enough and queries can compare the column directly.
    email: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Replaces the scan the in-memory store used to do. Doing it here also closes
  // the race two concurrent signups with the same email used to slip through.
  pgm.addConstraint('users', 'users_email_key', { unique: ['email'] });

  pgm.addConstraint('users', 'users_name_length_check', {
    check: 'char_length(btrim(name)) between 1 and 120',
  });
  pgm.addConstraint('users', 'users_email_shape_check', {
    check: "email = lower(btrim(email)) and position('@' in email) > 1",
  });

  // Listing orders by (created_at, id) so the sort is total and pages never
  // repeat or skip a row when two users share a timestamp.
  pgm.createIndex('users', [
    { name: 'created_at', sort: 'DESC' },
    { name: 'id', sort: 'DESC' },
  ]);
};

export const down = (pgm) => {
  pgm.dropTable('users');
};
