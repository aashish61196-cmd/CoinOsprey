// api/index.js
const app = require('../server.js');

module.exports = function handler(req, res) {
  const rawPath = req.query.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  req.url = '/api/' + path;   // niche point 2 dekho — /api/ zaroori hai
  return app(req, res);
};
