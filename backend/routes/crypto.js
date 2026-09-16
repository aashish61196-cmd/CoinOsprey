const router = require('express').Router();
const ctrl = require('../controllers/cryptoController');

router.get('/markets', ctrl.markets);
router.get('/global', ctrl.global);
router.get('/fear-greed', ctrl.fearGreed);

module.exports = router;
