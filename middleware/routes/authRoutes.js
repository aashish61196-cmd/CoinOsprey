const express = require("express");
const router = express.Router();
const { register, login, logout, getMe } = require("../../Controller/authController");
const { protect } = require("../auth");

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", protect, getMe);

module.exports = router;
