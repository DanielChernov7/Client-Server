/**
 * Regions API routes
 * GET /api/regions - Returns list of distinct regions
 */

const express = require('express');
const router = express.Router();
const tallinnApi = require('../tallinnApi');

/**
 * GET /api/regions
 * Returns list of distinct regions sorted alphabetically
 */
router.get('/', async (req, res) => {
    try {
        const regions = await tallinnApi.getRegions();

        res.json({
            success: true,
            count: regions.length,
            data: regions
        });
    } catch (error) {
        console.error('Error fetching regions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch regions'
        });
    }
});

module.exports = router;
