const jwt = require('jsonwebtoken');
const User = require('../models/User');
// PART 12A: expose the requesting user's advertising.* permissions
// alongside their role, so the Content Console can hide controls a user
// can't use without re-implementing the role->permission mapping itself.
// This never grants anything on its own — every protected endpoint still
// re-checks the same permissions.js server-side (spec item 10).
const { getUserPermissions } = require('../utils/permissions');

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: 'Email already registered' });
    const user = await User.create({ name, email, password, role: 'author' });
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'none', secure: true });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: getUserPermissions(user) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'none', secure: true });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: getUserPermissions(user) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
};

exports.me = async (req, res) => {
  const user = req.user.toObject ? req.user.toObject() : req.user;
  res.json({ user: { ...user, permissions: getUserPermissions(req.user) } });
};
