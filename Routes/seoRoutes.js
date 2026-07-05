const express = require("express");
const router = express.Router();
const { articleMeta } = require("../Controllers/seoController");

router.get("/article/:slug", articleMeta);

module.exports = router;
