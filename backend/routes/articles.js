const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

router.get('/', articleController.getPublished);       // list
router.get('/:slug', articleController.getBySlug);     // single article

module.exports = router;
