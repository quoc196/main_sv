/**
 * One wire format for every answer this API gives, success or failure:
 *
 *   { code, message, data, err_show_type?, meta?, details?, requestId? }
 *
 * `code` is the only field a client has to branch on — '00' means it worked.
 * `err_show_type` tells the frontend how loudly to surface `message`, so that
 * decision lives with the API instead of being re-guessed on every screen.
 */

export const SHOW_TYPE = {
  SILENT: 'SILENT', // handle quietly, show nothing to the user
  TOAST: 'TOAST', // brief inline notice
  POPUP: 'POPUP', // modal the user has to dismiss
  REDIRECT: 'REDIRECT', // send the user elsewhere, e.g. back to login
};

export const SUCCESS_CODE = '00';

/**
 * The contract with the frontend, in one place. ApiError carries the semantic
 * key (BAD_REQUEST, NOT_FOUND, ...) and this table turns it into the wire code
 * plus default copy — add a row here instead of hand-writing codes at a call
 * site, so no two endpoints ever disagree on what '05' means.
 */
export const CODES = {
  SUCCESS: { code: SUCCESS_CODE, message: 'Thành công' },

  BAD_REQUEST: { code: '01', message: 'Hệ thống từ chối yêu cầu', showType: SHOW_TYPE.POPUP },
  VALIDATION_ERROR: { code: '02', message: 'Dữ liệu không hợp lệ', showType: SHOW_TYPE.TOAST },
  UNAUTHORIZED: { code: '03', message: 'Bạn cần đăng nhập lại', showType: SHOW_TYPE.REDIRECT },
  FORBIDDEN: { code: '04', message: 'Bạn không có quyền thực hiện', showType: SHOW_TYPE.POPUP },
  NOT_FOUND: { code: '05', message: 'Không tìm thấy dữ liệu', showType: SHOW_TYPE.TOAST },
  CONFLICT: { code: '06', message: 'Dữ liệu đã tồn tại', showType: SHOW_TYPE.POPUP },
  UNPROCESSABLE_ENTITY: {
    code: '07',
    message: 'Không xử lý được yêu cầu',
    showType: SHOW_TYPE.POPUP,
  },
  TOO_MANY_REQUESTS: {
    code: '08',
    message: 'Bạn thao tác quá nhanh, thử lại sau',
    showType: SHOW_TYPE.TOAST,
  },
  PAYLOAD_TOO_LARGE: { code: '09', message: 'Dữ liệu gửi lên quá lớn', showType: SHOW_TYPE.TOAST },
  SERVICE_UNAVAILABLE: {
    code: '10',
    message: 'Hệ thống tạm thời không phục vụ được, thử lại sau',
    showType: SHOW_TYPE.POPUP,
  },

  INTERNAL_SERVER_ERROR: {
    code: '99',
    message: 'Hệ thống đang gặp sự cố',
    showType: SHOW_TYPE.POPUP,
  },
  // Fallback for any status with no row of its own.
  ERROR: { code: '99', message: 'Hệ thống đang gặp sự cố', showType: SHOW_TYPE.POPUP },
};

/** Success envelope. `message` is optional — the table's copy is the default. */
export function success({ data = {}, message, meta } = {}) {
  return {
    code: SUCCESS_CODE,
    message: message || CODES.SUCCESS.message,
    data,
    ...(meta ? { meta } : {}),
  };
}

/**
 * Failure envelope. `key` is an ApiError code; an unknown key falls back to
 * ERROR rather than leaking an internal name onto the wire.
 */
export function failure(key, { message, details, requestId, stack } = {}) {
  const row = CODES[key] ?? CODES.ERROR;

  return {
    code: row.code,
    err_show_type: row.showType,
    message: message || row.message,
    data: {},
    ...(details ? { details } : {}),
    ...(requestId ? { requestId } : {}),
    ...(stack ? { stack } : {}),
  };
}
