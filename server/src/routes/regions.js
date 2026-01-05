/**
 * Regions API routes
 * GET /api/regions - Returns list of distinct regions
 */

const express = require('express');
const router = express.Router();
const { query, table } = require('../db');

/**
 * GET /api/regions
 * Returns list of distinct regions sorted alphabetically
 */
router.get('/', async (req, res) => {
    try {
        const sql = `
            SELECT DISTINCT region
            FROM ${table('stops')}
            WHERE region IS NOT NULL
              AND region != ''
              AND region != 'Unknown'
            ORDER BY region ASC
        `;

        const rows = await query(sql);
        const regions = rows.map(row => row.region);

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
