import app from '../server.js';
// api/index.js
export default function handler(req, res) {
  const rawPath = req.query.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  req.url = '/' + path; // ab Express isko sahi route samjhega
  return app(req, res);
}
