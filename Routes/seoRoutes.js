const express = require("express");
const router = express.Router();
const { articleMeta } = require("../controllers/seoController");

router.get("/article/:slug", articleMeta);

module.exports = router;
