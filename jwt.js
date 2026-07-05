/* ==============================================================
   config/jwt.js
   Central place for JWT config + sign/verify helpers. Both
   access tokens (short-lived, sent on every request) and
   refresh tokens (long-lived, used only to mint new access
   tokens) are handled here so the secrets/expiry never drift
   between files that need them.
   ============================================================== */

const jwt = require("jsonwebtoken");

const ACCESS_SECRET = process.env.JWT_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  // Fail fast on boot rather than issuing tokens with an undefined secret.
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be set in the environment");
}

/**
 * Sign a short-lived access token. Payload should only ever
 * contain non-sensitive identifiers — never passwords or emails
 * beyond what's needed for lookups.
 */
function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

/** Sign a long-lived refresh token, used only to mint new access tokens. */
function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

/** Verify an access token. Throws if invalid/expired — caller should catch. */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/** Verify a refresh token. Throws if invalid/expired — caller should catch. */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = {
  ACCESS_EXPIRES_IN,
  REFRESH_EXPIRES_IN,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
