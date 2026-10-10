import { query } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';

/** Reference data for pickers and filters. Changes only with a migration. */

export async function listProvinces() {
  const { rows } = await query('SELECT code, name FROM provinces ORDER BY code');
  return rows;
}

export async function listWards(provinceCode) {
  const { rows } = await query(
    'SELECT code, name FROM wards WHERE province_code = $1 ORDER BY name',
    [provinceCode]
  );
  if (!rows.length) {
    throw ApiError.notFound(`Province ${provinceCode} not found`, {
      userMessage: 'Không tìm thấy tỉnh/thành',
    });
  }
  return rows;
}

export async function listAmenities() {
  const { rows } = await query(
    'SELECT code, name, icon_url AS "iconUrl" FROM amenities ORDER BY position, code'
  );
  return rows;
}
