const express = require("express");
const router = express.Router();
const { getMarkets, getGlobal, getFearGreed } = require("../controllers/apiController");

router.get("/markets", getMarkets);
router.get("/global", getGlobal);
router.get("/fear-greed", getFearGreed);

module.exports = router;
