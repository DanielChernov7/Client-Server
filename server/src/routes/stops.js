/**
 * Stops API routes
 * GET /api/stops - Returns stops for a region
 */

const express = require('express');
const router = express.Router();
const { query, table } = require('../db');

/**
 * GET /api/stops
 * Query params:
 *   - region: Region name (required)
 * Returns list of stops in the region
 */
router.get('/', async (req, res) => {
    try {
        const { region } = req.query;

        if (!region) {
            return res.status(400).json({
                success: false,
                error: 'Region parameter is required'
            });
        }

        const sql = `
            SELECT
                stop_id,
                stop_code,
                stop_name,
                stop_desc,
                stop_lat,
                stop_lon,
                zone_id,
                region
            FROM ${table('stops')}
            WHERE region = ?
            ORDER BY stop_name ASC
        `;

        const rows = await query(sql, [region]);

        res.json({
            success: true,
            region: region,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Error fetching stops:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stops'
        });
    }
});

/**
 * GET /api/stops/:id
 * Returns single stop by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const sql = `
            SELECT
                stop_id,
                stop_code,
                stop_name,
                stop_desc,
                stop_lat,
                stop_lon,
                zone_id,
                region
            FROM ${table('stops')}
            WHERE stop_id = ?
        `;

        const rows = await query(sql, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Stop not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Error fetching stop:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stop'
        });
    }
});

module.exports = router;
