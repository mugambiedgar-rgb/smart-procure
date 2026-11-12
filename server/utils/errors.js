'use strict';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const badRequest = (m, x) => new HttpError(400, m, x);
const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
const forbidden = (m = 'You do not have permission to perform this action') => new HttpError(403, m);
const notFound = (m = 'Resource not found') => new HttpError(404, m);
const conflict = (m, x) => new HttpError(409, m, x);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
