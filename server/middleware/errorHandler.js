'use strict';
const { HttpError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON in request body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body too large' });

  // Translate common MySQL errors into friendly responses
  switch (err.code) {
    case 'ER_DUP_ENTRY': return res.status(409).json({ message: 'A record with the same unique value already exists (' + (err.sqlMessage || '').replace(/^Duplicate entry '(.*)' for key.*$/, '$1') + ').' });
    case 'ER_NO_REFERENCED_ROW_2': return res.status(400).json({ message: 'A referenced record does not exist.' });
    case 'ER_ROW_IS_REFERENCED_2': return res.status(409).json({ message: 'This record is in use by other records and cannot be removed.' });
    case 'ER_CHECK_CONSTRAINT_VIOLATED': return res.status(400).json({ message: 'The change violates a data rule (for example, stock cannot go negative).' });
    case 'ER_DATA_TOO_LONG': return res.status(400).json({ message: 'One of the values is too long.' });
    case 'ER_LOCK_DEADLOCK':
    case 'ER_LOCK_WAIT_TIMEOUT': return res.status(503).json({ message: 'The system is busy. Please try again.' });
    default: break;
  }
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ message: 'Internal server error' });
}

module.exports = { notFoundHandler, errorHandler };
