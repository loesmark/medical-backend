/**
 * Route index — mounts all route modules under /api/v1.
 */

const express = require('express');
const router = express.Router();

router.use('/health', require('./health'));
router.use('/auth', require('./auth'));
router.use('/patient', require('./patient'));
router.use('/admin', require('./admin'));
router.use('/catalogs', require('./catalogs'));

module.exports = router;
