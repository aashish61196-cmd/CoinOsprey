router.get('/', articleController.getAllArticles);       // list
router.get('/:slug', articleController.getArticleBySlug); // single article
