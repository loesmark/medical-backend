/**
 * Catalog routes — /api/v1/catalogs/*
 *
 *   GET    /:catalog                          → patient list (read-only) / admin paged
 *   GET    /:catalog/:id                      → single item (admin only really,
 *                                                but patient can also fetch by id)
 *   POST   /:catalog                          → admin only
 *   PUT    /:catalog/:id                      → admin only
 *   DELETE /:catalog/:id                      → admin only
 *
 * Auth: authenticate (any role) — the controller branches on role for write ops.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimit');
const catalogController = require('../controllers/catalogController');
const catalogService = require('../services/catalogService');
const { ok } = require('../utils/response');
const { upsert: catalogUpsert } = require('../validators/catalogValidator');

router.use(authenticate, apiLimiter);

// GET / → the list of available catalog names (so the client can build URLs)
router.get('/', (req, res) => ok(res, catalogService.CATALOGS, 'Available catalogs.'));

router.get('/:catalog', catalogController.list);
router.get('/:catalog/:id', catalogController.getOne);
router.post('/:catalog', catalogUpsert, catalogController.create);
router.put('/:catalog/:id', catalogUpsert, catalogController.update);
router.delete('/:catalog/:id', catalogController.remove);

module.exports = router;
