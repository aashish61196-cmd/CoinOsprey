const express = require("express");
const router = express.Router();
const {
  getCommentsForArticle,
  createComment,
  listAllCommentsForAdmin,
  updateCommentStatus,
  deleteComment,
} = require("../Controllers/commentController");
const { protect } = require("../middleware/auth");
const { permit } = require("../middleware/admin");

// Public
router.get("/article/:articleId", getCommentsForArticle);
router.post("/", createComment);

// Protected — moderation
router.get("/admin/all", protect, permit("admin", "editor"), listAllCommentsForAdmin);
router.patch("/:id/status", protect, permit("admin", "editor"), updateCommentStatus);
router.delete("/:id", protect, permit("admin", "editor"), deleteComment);

module.exports = router;
