/* ==============================================================
   middleware/auth.js
   Protects routes by requiring a valid access token, either as
   "Authorization: Bearer <token>" or an httpOnly "accessToken"
   cookie. On success, attaches the user document to req.user
   (password field excluded) so controllers never re-fetch it.
   ============================================================== */

const { verifyAccessToken } = require("../config/jwt");
const User = require("../models/User");

async function protect(req, res, next) {
  try {
    let token;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authorized — no token provided" });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const message = err.name === "TokenExpiredError" ? "Session expired — please log in again" : "Invalid token";
      return res.status(401).json({ success: false, message });
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ success: false, message: "User for this token no longer exists" });
    }
    if (user.isBanned) {
      return res.status(403).json({ success: false, message: "This account has been suspended" });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth: attaches req.user if a valid token is present,
 * but never blocks the request if it's missing/invalid. Useful
 * for routes like article GET where logged-in users see extra
 * fields (e.g. "liked" state) but guests can still read.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    if (!token) return next();

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select("-password");
    if (user && !user.isBanned) req.user = user;
    next();
  } catch (err) {
    // Invalid/expired token on an optional route — proceed as a guest.
    next();
  }
}

module.exports = { protect, optionalAuth };
