const validator = require("validator");

function isValidEmail(email) {
  return typeof email === "string" && validator.isEmail(email);
}

function isStrongEnoughPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

/**
 * Strips a small allowlist-based set of dangerous tags/attrs from HTML
 * article bodies. This is intentionally conservative — it is NOT a full
 * sanitizer. For production, swap in `sanitize-html` or `dompurify` (jsdom).
 */
function basicSanitize(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function required(fields, body) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === "" || body[f] === null);
  return missing;
}

module.exports = { isValidEmail, isStrongEnoughPassword, basicSanitize, required };
