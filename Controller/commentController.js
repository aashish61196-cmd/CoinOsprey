const Comment = require("../models/Comment");
const Article = require("../models/Article");
const { isValidEmail, required } = require("../Utils/validator");
const { sendCommentApprovedEmail } = require("../Services/emailService");

// GET /api/comments/article/:articleId  (public — approved only)
exports.getCommentsForArticle = async (req, res, next) => {
  try {
    const comments = await Comment.find({ article: req.params.articleId, status: "approved" }).sort({
      createdAt: -1,
    });
    res.json({ success: true, data: comments });
  } catch (err) {
    next(err);
  }
};

// POST /api/comments  (public — always goes in as "pending" to prevent spam going live)
exports.createComment = async (req, res, next) => {
  try {
    const missing = required(["article", "name", "email", "body"], req.body);
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing fields: ${missing.join(", ")}` });
    }
    if (!isValidEmail(req.body.email)) {
      return res.status(400).json({ success: false, message: "Invalid email address." });
    }

    const article = await Article.findById(req.body.article);
    if (!article) return res.status(404).json({ success: false, message: "Article not found." });

    const comment = await Comment.create({
      article: req.body.article,
      name: req.body.name,
      email: req.body.email,
      body: req.body.body,
      parent: req.body.parent || null,
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: "Comment submitted and awaiting moderation.",
      data: comment,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/comments/admin/all  (protected — moderation queue)
exports.listAllCommentsForAdmin = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const comments = await Comment.find(filter)
      .populate("article", "title slug")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: comments });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/comments/:id/status  (protected — approve/reject/spam)
exports.updateCommentStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["pending", "approved", "spam", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    const comment = await Comment.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate(
      "article",
      "title slug"
    );
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found." });

    if (status === "approved" && comment.article) {
      const url = `${process.env.CLIENT_URL || ""}/article/${comment.article.slug}`;
      sendCommentApprovedEmail(comment.email, comment.article.title, url).catch(() => {});
    }

    res.json({ success: true, data: comment });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/comments/:id  (protected)
exports.deleteComment = async (req, res, next) => {
  try {
    const comment = await Comment.findByIdAndDelete(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found." });
    res.json({ success: true, message: "Comment deleted." });
  } catch (err) {
    next(err);
  }
};
