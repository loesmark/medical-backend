/**
 * Health routes — public, no auth.
 */

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

router.get('/', healthController.check);
router.get('/live', healthController.check);

module.exports = router;
