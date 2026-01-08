/**
 * Stops API routes
 * GET /api/stops - Returns stops for a region
 */

const express = require('express');
const router = express.Router();
const tallinnApi = require('../tallinnApi');

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

        const stops = await tallinnApi.getStopsByRegion(region);

        // Transform to match expected format
        const data = stops.map(s => ({
            stop_id: s.stopIds[0] || s.id,
            stop_code: s.id,
            stop_name: s.name,
            stop_desc: s.area,
            stop_lat: s.lat,
            stop_lon: s.lng,
            zone_id: s.city,
            region: s.area
        }));

        res.json({
            success: true,
            region: region,
            count: data.length,
            data: data
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
        const stops = await tallinnApi.getStops();
        const stop = stops.find(s => s.id === id || s.stopIds.includes(id));

        if (!stop) {
            return res.status(404).json({
                success: false,
                error: 'Stop not found'
            });
        }

        res.json({
            success: true,
            data: {
                stop_id: stop.stopIds[0] || stop.id,
                stop_code: stop.id,
                stop_name: stop.name,
                stop_desc: stop.area,
                stop_lat: stop.lat,
                stop_lon: stop.lng,
                zone_id: stop.city,
                region: stop.area
            }
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
