import * as db from '../src/db/index.js';

/**
 * The first admin cannot be created through the API (only admins manage
 * roles), so it is promoted from a shell with database access:
 *
 *   npm run user:promote -- someone@example.com
 *
 * The change reaches their access token at the next refresh.
 */
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run user:promote -- <email>');
  process.exit(1);
}

await db.connect();
const { rowCount } = await db.query(
  "UPDATE users SET role = 'admin', updated_at = now() WHERE email = $1",
  [email]
);
await db.disconnect();

if (!rowCount) {
  console.error(`[promote] No user with email ${email}`);
  process.exit(1);
}
console.log(`[promote] ${email} is now an admin`);
