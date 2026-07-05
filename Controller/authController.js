const User = require("../models/User");
const generateTokenAndRespond = require("../Utils/generateToken");
const { isValidEmail, isStrongEnoughPassword, required } = require("../Utils/validator");

// POST /api/auth/register  (creates an "author" by default — promote to
// editor/admin via the admin user-management endpoint, not self-service)
exports.register = async (req, res, next) => {
  try {
    const missing = required(["name", "email", "password"], req.body);
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing fields: ${missing.join(", ")}` });
    }
    const { name, email, password } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address." });
    }
    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with that email already exists." });
    }

    const user = await User.create({ name, email, password, role: "author" });
    generateTokenAndRespond(res, user, 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }
    if (!user.active) {
      return res.status(403).json({ success: false, message: "This account has been deactivated." });
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    generateTokenAndRespond(res, user, 200);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
exports.logout = (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out." });
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user.toSafeJSON() });
};
