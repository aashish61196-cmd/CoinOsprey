const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

router.get('/', articleController.getAllArticles);       // list
router.get('/:slug', articleController.getArticleBySlug); // single article

module.exports = router;
