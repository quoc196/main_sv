import { randomUUID } from 'node:crypto';

import { transaction } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';
import * as storage from '../../utils/storage.js';

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The type is read from the file's first bytes, not from the client's
 * Content-Type or file name: both are just claims, and a public bucket must
 * not end up serving an HTML page or a script under an image name.
 */
function sniff(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { ext: 'png', type: 'image/png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

const notFound = (id) =>
  ApiError.notFound(`Listing ${id} not found`, { userMessage: 'Không tìm thấy tin đăng' });

/**
 * Uploads then records the images. New photos change what was approved, so an
 * active listing goes back to review, same as any other edit.
 */
export async function add(listingId, user, files) {
  if (!files?.length) {
    throw ApiError.badRequest('No files in field "images"', {
      userMessage: 'Vui lòng chọn ảnh để tải lên',
    });
  }
  const typed = files.map((file) => ({ file, kind: sniff(file.buffer) }));
  if (typed.some((t) => !t.kind)) {
    throw ApiError.badRequest('Unsupported image type', {
      userMessage: 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP',
    });
  }

  const uploaded = [];
  try {
    await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT owner_id FROM listings WHERE id = $1 FOR UPDATE',
        [listingId]
      );
      if (!rows.length || rows[0].owner_id !== user.id) throw notFound(listingId);

      const { rows: stats } = await client.query(
        'SELECT count(*)::int AS n, COALESCE(max(position), -1) AS last FROM listing_images WHERE listing_id = $1',
        [listingId]
      );
      if (stats[0].n + files.length > MAX_IMAGES) {
        throw ApiError.badRequest(`Listing ${listingId} would exceed ${MAX_IMAGES} images`, {
          userMessage: `Mỗi tin tối đa ${MAX_IMAGES} ảnh`,
        });
      }

      let position = stats[0].last;
      for (const { file, kind } of typed) {
        const path = `${listingId}/${randomUUID()}.${kind.ext}`;
        await storage.upload(path, file.buffer, kind.type);
        uploaded.push(path);
        position += 1;
        await client.query(
          'INSERT INTO listing_images (listing_id, storage_path, position) VALUES ($1, $2, $3)',
          [listingId, path, position]
        );
      }

      await client.query(
        `UPDATE listings SET status = 'pending', reject_reason = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('active', 'rejected')`,
        [listingId]
      );
    });
  } catch (err) {
    // The rows rolled back; the files already in the bucket did not.
    await storage.remove(uploaded);
    throw err;
  }
}

export async function remove(listingId, imageId, user) {
  const path = await transaction(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM listing_images i
        USING listings l
        WHERE i.id = $1 AND i.listing_id = $2 AND l.id = i.listing_id AND l.owner_id = $3
        RETURNING i.storage_path`,
      [imageId, listingId, user.id]
    );
    if (!rows.length) {
      throw ApiError.notFound(`Image ${imageId} not found`, {
        userMessage: 'Không tìm thấy ảnh',
      });
    }
    return rows[0].storage_path;
  });
  await storage.remove([path]);
}
