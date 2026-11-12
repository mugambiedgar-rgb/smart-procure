'use strict';
// Express 5 forwards rejected promises to the error handler automatically,
// so route handlers can simply be async functions.
const likeParam = (s) => `%${String(s).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
module.exports = { likeParam };
