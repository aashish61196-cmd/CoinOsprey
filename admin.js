/**
 * Restricts a route to specific roles. Use after `protect`.
 * Example: router.delete("/:id", protect, permit("admin"), handler)
 */
function permit(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not permitted to perform this action.`,
      });
    }
    next();
  };
}

module.exports = { permit, isAdmin: permit("admin") };
