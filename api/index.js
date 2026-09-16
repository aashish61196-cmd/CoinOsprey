// api/index.js
const app = require('../backend/server.js');

module.exports = function handler(req, res) {
  const rawPath = req.query.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');

  // `path` is just the routing segment Vercel used to pick this function.
  // Every OTHER query param on the original request (e.g. ?language=hi,
  // ?section=news) is still sitting in req.query and MUST be forwarded to
  // Express, or downstream handlers silently fall back to their defaults
  // (e.g. language always resolving to "en"). Rebuild the query string
  // from everything except the internal "path" param.
  const searchParams = new URLSearchParams();
  for (const key of Object.keys(req.query)) {
    if (key === 'path') continue;
    const value = req.query[key];
    if (Array.isArray(value)) {
      value.forEach((v) => searchParams.append(key, v));
    } else if (value !== undefined) {
      searchParams.append(key, value);
    }
  }
  const qs = searchParams.toString();

  req.url = '/api/' + path + (qs ? '?' + qs : '');
  return app(req, res);
};
