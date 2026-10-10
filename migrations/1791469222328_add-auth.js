/**
 * Credentials and roles on `users`, plus the refresh-token store.
 *
 * password_hash stays nullable: rows created before auth existed have none,
 * and such a user simply cannot log in until an admin or a reset sets one.
 */

export const up = (pgm) => {
  pgm.addColumns('users', {
    password_hash: { type: 'text' },
    role: { type: 'text', notNull: true, default: 'user' },
  });
  // A CHECK instead of a Postgres ENUM: adding a role later is one migration
  // that swaps the constraint, not an ALTER TYPE that cannot run in a transaction.
  pgm.addConstraint('users', 'users_role_check', { check: "role IN ('user', 'admin')" });

  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    // Only the SHA-256 of the token is stored: a leaked table cannot be replayed.
    token_hash: { type: 'text', notNull: true, unique: true },
    // Every token minted by rotating the same login shares a family, so reuse
    // of an already-rotated token can revoke that whole session at once.
    family_id: { type: 'uuid', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('refresh_tokens', 'family_id');
  pgm.createIndex('refresh_tokens', 'user_id');
};

export const down = (pgm) => {
  pgm.dropTable('refresh_tokens');
  pgm.dropConstraint('users', 'users_role_check');
  pgm.dropColumns('users', ['password_hash', 'role']);
};
