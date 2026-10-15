// Errors thrown by server operations. `message` is always safe to show the person.

export const ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'duplicate',
  'rate_limited',
  'timeout',
  'unavailable',
  'unsupported',
  'not_implemented',
];

export class ApiError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message safe, user-facing explanation of what happened and what to do
   * @param {object} [details] structured data, e.g. { fields: { name: 'Enter a name' } }
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'That item') => new ApiError('not_found', `${what} could not be found.`);

export const invalid = (fields, message = 'Check the highlighted fields.') =>
  new ApiError('invalid', message, { fields });

export function isApiError(error, code) {
  return error instanceof ApiError && (code ? error.code === code : true);
}
