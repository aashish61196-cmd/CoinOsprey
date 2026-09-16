const router = require('express').Router();
const ctrl = require('../controllers/rankingsController');

router.get('/', ctrl.getRankings);

module.exports = router;
