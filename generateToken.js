const jwt = require('jsonwebtoken');

/**
 * Generate a short-lived access token for a user.
 * Sent in the response body, used in the Authorization header for API calls.
 */
function generateToken(userId, role = 'user') {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

/**
 * Generate a long-lived refresh token for a user.
 * Sent only as an httpOnly cookie, used solely to mint new access tokens.
 */
function generateRefreshToken(userId) {
  return jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
}

module.exports = { generateToken, generateRefreshToken };
