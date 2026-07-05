const User = require("../models/User");
const Article = require("../models/Article");
const Comment = require("../models/Comment");
const Newsletter = require("../models/Newsletter");
const Category = require("../models/Category");

// GET /api/admin/stats  (dashboard overview cards)
exports.getStats = async (req, res, next) => {
  try {
    const [totalArticles, publishedArticles, draftArticles, pendingComments, totalSubscribers, totalUsers, totalViewsAgg] =
      await Promise.all([
        Article.countDocuments(),
        Article.countDocuments({ status: "published" }),
        Article.countDocuments({ status: "draft" }),
        Comment.countDocuments({ status: "pending" }),
        Newsletter.countDocuments({ status: "subscribed" }),
        User.countDocuments(),
        Article.aggregate([{ $group: { _id: null, total: { $sum: "$views" } } }]),
      ]);

    res.json({
      success: true,
      data: {
        totalArticles,
        publishedArticles,
        draftArticles,
        pendingComments,
        totalSubscribers,
        totalUsers,
        totalViews: totalViewsAgg[0] ? totalViewsAgg[0].total : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/users
exports.listUsers = async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, data: users.map((u) => u.toSafeJSON()) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/users/:id  (change role / active status — admin only)
exports.updateUser = async (req, res, next) => {
  try {
    const { role, active } = req.body;
    const updates = {};
    if (role) updates.role = role;
    if (typeof active === "boolean") updates.active = active;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    res.json({ success: true, data: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account." });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    res.json({ success: true, message: "User deleted." });
  } catch (err) {
    next(err);
  }
};

// ----- Categories -----

// GET /api/admin/categories
exports.listCategories = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/categories
exports.createCategory = async (req, res, next) => {
  try {
    if (!req.body.name) return res.status(400).json({ success: false, message: "Category name is required." });
    const category = await Category.create({ name: req.body.name, description: req.body.description || "" });
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/categories/:id
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: "Category not found." });
    res.json({ success: true, message: "Category deleted." });
  } catch (err) {
    next(err);
  }
};
