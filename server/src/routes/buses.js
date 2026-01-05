/**
 * Buses API routes
 * GET /api/buses - Returns buses (routes) that stop at a given stop
 */

const express = require('express');
const router = express.Router();
const { query, table } = require('../db');

/**
 * Natural sort comparator for bus route numbers
 * Handles alphanumeric routes like 2, 9, 10, 10A, 11, 100, 100A
 * @param {string} a - First route name
 * @param {string} b - Second route name
 * @returns {number} Comparison result
 */
function naturalRouteSort(a, b) {
    // Extract numeric prefix and suffix
    const regex = /^(\d*)(\D*)$/;

    const matchA = a.match(regex) || ['', a, ''];
    const matchB = b.match(regex) || ['', b, ''];

    const numA = matchA[1] ? parseInt(matchA[1], 10) : Infinity;
    const numB = matchB[1] ? parseInt(matchB[1], 10) : Infinity;

    // Compare numeric parts first
    if (numA !== numB) {
        return numA - numB;
    }

    // If numeric parts equal, compare suffix alphabetically
    const suffixA = matchA[2] || '';
    const suffixB = matchB[2] || '';

    return suffixA.localeCompare(suffixB);
}

/**
 * GET /api/buses
 * Query params:
 *   - stopId: Stop ID (required)
 * Returns list of distinct bus routes (route_short_name) that stop at this stop
 */
router.get('/', async (req, res) => {
    try {
        const { stopId } = req.query;

        if (!stopId) {
            return res.status(400).json({
                success: false,
                error: 'stopId parameter is required'
            });
        }

        // Find all distinct routes that have trips stopping at this stop
        const sql = `
            SELECT DISTINCT
                r.route_id,
                r.route_short_name,
                r.route_long_name,
                r.route_type
            FROM ${table('stop_times')} st
            JOIN ${table('trips')} t ON st.trip_id = t.trip_id
            JOIN ${table('routes')} r ON t.route_id = r.route_id
            WHERE st.stop_id = ?
            ORDER BY r.route_short_name
        `;

        const rows = await query(sql, [stopId]);

        // Sort using natural route sorting
        rows.sort((a, b) => naturalRouteSort(
            a.route_short_name || '',
            b.route_short_name || ''
        ));

        // Extract just the route names for the simple list
        const routeNames = [...new Set(rows.map(r => r.route_short_name))].filter(Boolean);

        res.json({
            success: true,
            stopId: stopId,
            count: routeNames.length,
            data: routeNames,
            details: rows
        });
    } catch (error) {
        console.error('Error fetching buses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch buses'
        });
    }
});

module.exports = router;
