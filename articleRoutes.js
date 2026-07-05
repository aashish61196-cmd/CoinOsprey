const express = require("express");
const router = express.Router();
const {
  listArticles,
  getArticleBySlug,
  listAllArticlesForAdmin,
  createArticle,
  updateArticle,
  deleteArticle,
} = require("../controllers/articleController");
const { protect } = require("../middleware/auth");
const { permit } = require("../middleware/admin");
const upload = require("../middleware/upload");

// Public
router.get("/", listArticles);

// Protected — order matters: this must come before "/:slug"
router.get("/admin/all", protect, permit("admin", "editor"), listAllArticlesForAdmin);
router.post("/", protect, permit("admin", "editor", "author"), upload.single("coverImage"), createArticle);
router.put("/:id", protect, permit("admin", "editor", "author"), upload.single("coverImage"), updateArticle);
router.delete("/:id", protect, permit("admin", "editor", "author"), deleteArticle);

// Public — keep last since ":slug" is a catch-all
router.get("/:slug", getArticleBySlug);

module.exports = router;
