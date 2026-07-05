const express = require("express");
const router = express.Router();
const {
  getStats,
  listUsers,
  updateUser,
  deleteUser,
  listCategories,
  createCategory,
  deleteCategory,
} = require("../Controller/adminController");
const { protect } = require("../middleware/auth");
const { permit } = require("../middleware/admin");

router.use(protect); // everything below requires login

router.get("/stats", permit("admin", "editor"), getStats);

router.get("/users", permit("admin"), listUsers);
router.patch("/users/:id", permit("admin"), updateUser);
router.delete("/users/:id", permit("admin"), deleteUser);

router.get("/categories", permit("admin", "editor"), listCategories);
router.post("/categories", permit("admin", "editor"), createCategory);
router.delete("/categories/:id", permit("admin"), deleteCategory);

module.exports = router;
