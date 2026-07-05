/* ==============================================================
   middleware/admin.js
   Restricts a route to admin users. Always run AFTER
   middleware/auth.js's `protect`, since it relies on req.user
   already being set.
   ============================================================== */

function adminOnly(req, res, next) {
  if (!req.user) {
    // Should never happen if `protect` ran first, but guard anyway.
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

/**
 * Broader guard for roles like "editor" who can manage articles
 * but shouldn't reach user-management or site-settings endpoints.
 * Usage: allowRoles("admin", "editor")
 */
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: `Requires one of these roles: ${roles.join(", ")}` });
    }
    next();
  };
}

module.exports = { adminOnly, allowRoles };
