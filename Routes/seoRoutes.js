const express = require("express");
const router = express.Router();
const { articleMeta } = require("../Controller/seoController");

router.get("/article/:slug", articleMeta);

module.exports = router;
