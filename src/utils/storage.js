import config from '../config/index.js';
import logger from '../config/logger.js';
import ApiError from './ApiError.js';

/**
 * Supabase Storage over its REST API: three calls do not justify the SDK.
 * Objects live in one public bucket; the database keeps only their path.
 */

export function isEnabled() {
  return Boolean(config.storage.url && config.storage.serviceKey);
}

function assertEnabled() {
  if (!isEnabled()) {
    throw new ApiError(503, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set', {
      code: 'SERVICE_UNAVAILABLE',
    });
  }
}

const objectUrl = (path) =>
  `${config.storage.url}/storage/v1/object/${config.storage.bucket}/${path}`;

const authHeaders = () => ({
  authorization: `Bearer ${config.storage.serviceKey}`,
  apikey: config.storage.serviceKey,
});

/** Public URL of a stored object; null when storage is not configured. */
export function publicUrl(path) {
  if (!config.storage.url || !path) return null;
  return `${config.storage.url}/storage/v1/object/public/${config.storage.bucket}/${path}`;
}

export async function upload(path, buffer, contentType) {
  assertEnabled();
  const res = await fetch(objectUrl(path), {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': contentType, 'cache-control': 'max-age=31536000' },
    body: buffer,
  });
  if (!res.ok) {
    throw ApiError.internal(`Storage upload failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Best effort: a leftover file costs a few KB, while failing the user's delete
 * because storage hiccuped would be worse. Failures are logged for cleanup.
 */
export async function remove(paths) {
  if (!paths.length || !isEnabled()) return;
  try {
    const res = await fetch(`${config.storage.url}/storage/v1/object/${config.storage.bucket}`, {
      method: 'DELETE',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (err) {
    logger.warn({ err, paths }, 'Could not delete storage objects');
  }
}
