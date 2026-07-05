const User = require('../models/User');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const Newsletter = require('../models/Newsletter');
const Category = require('../models/Category');
const logger = require('../utils/logger');

// @desc    Get dashboard overview stats
// @route   GET /api/admin/dashboard
// @access  Private (admin)
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalArticles,
      publishedArticles,
      draftArticles,
      totalComments,
      pendingComments,
      totalSubscribers,
      totalViews,
    ] = await Promise.all([
      User.countDocuments(),
      Article.countDocuments(),
      Article.countDocuments({ status: 'published' }),
      Article.countDocuments({ status: 'draft' }),
      Comment.countDocuments(),
      Comment.countDocuments({ status: 'pending' }),
      Newsletter.countDocuments({ status: 'subscribed' }),
      Article.aggregate([
        { $group: { _id: null, total: { $sum: '$views' } } },
      ]),
    ]);

    // Articles published per market type, for a quick content-mix snapshot
    const articlesByMarketType = await Article.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$marketType', count: { $sum: 1 } } },
    ]);

    // Most viewed articles this week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const topArticlesThisWeek = await Article.find({
      status: 'published',
      publishedAt: { $gte: oneWeekAgo },
    })
      .sort({ views: -1 })
      .limit(5)
      .select('title slug views assetSymbol');

    res.status(200).json({
      success: true,
      data: {
        totals: {
          users: totalUsers,
          articles: totalArticles,
          publishedArticles,
          draftArticles,
          comments: totalComments,
          pendingComments,
          newsletterSubscribers: totalSubscribers,
          totalViews: totalViews[0]?.total || 0,
        },
        articlesByMarketType,
        topArticlesThisWeek,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all users with pagination and filters
// @route   GET /api/admin/users
// @access  Private (admin)
exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const query = {};

    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update a user's role
// @route   PATCH /api/admin/users/:id/role
// @access  Private (admin)
exports.updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = ['user', 'editor', 'admin'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${validRoles.join(', ')}`,
      });
    }

    // Prevent an admin from demoting themselves and locking everyone out
    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own admin role',
      });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    logger.info(`User ${user.email} role changed to "${role}" by ${req.user.id}`);

    res.status(200).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @desc    Activate or deactivate a user account
// @route   PATCH /api/admin/users/:id/status
// @access  Private (admin)
exports.toggleUserStatus = async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account',
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isActive = !user.isActive;
    await user.save({ validateBeforeSave: false });

    logger.info(`User ${user.email} status set to ${user.isActive ? 'active' : 'inactive'}`);

    res.status(200).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @desc    Create a new category
// @route   POST /api/admin/categories
// @access  Private (admin)
exports.createCategory = async (req, res, next) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

// @desc    Update a category
// @route   PUT /api/admin/categories/:id
// @access  Private (admin)
exports.updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    Object.keys(req.body).forEach((key) => {
      category[key] = req.body[key];
    });

    await category.save();
    res.status(200).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a category (only if no articles use it)
// @route   DELETE /api/admin/categories/:id
// @access  Private (admin)
exports.deleteCategory = async (req, res, next) => {
  try {
    const articleCount = await Article.countDocuments({ category: req.params.id });
    if (articleCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${articleCount} existing article(s). Reassign them first.`,
      });
    }

    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Get content production stats (articles per author, per day)
// @route   GET /api/admin/production-stats
// @access  Private (admin)
exports.getProductionStats = async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    const statsByAuthor = await Article.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$author',
          articleCount: { $sum: 1 },
          formats: { $push: '$articleFormat' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'authorInfo',
        },
      },
      { $unwind: '$authorInfo' },
      {
        $project: {
          articleCount: 1,
          formats: 1,
          'authorInfo.name': 1,
          'authorInfo.email': 1,
        },
      },
    ]);

    const statsByDay = await Article.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({ success: true, data: { statsByAuthor, statsByDay } });
  } catch (err) {
    next(err);
  }
};
