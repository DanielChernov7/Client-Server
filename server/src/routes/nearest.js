/**
 * Nearest Stop API routes
 * GET /api/nearest - Returns nearest bus stop to given coordinates
 */

const express = require('express');
const router = express.Router();
const tallinnApi = require('../tallinnApi');

/**
 * GET /api/nearest
 * Query params:
 *   - lat: Latitude (required)
 *   - lon: Longitude (required)
 * Returns nearest stop with region info
 */
router.get('/', async (req, res) => {
    try {
        const { lat, lon } = req.query;

        if (!lat || !lon) {
            return res.status(400).json({
                success: false,
                error: 'lat and lon parameters are required'
            });
        }

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);

        if (isNaN(latitude) || isNaN(longitude)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Validate coordinate ranges
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({
                success: false,
                error: 'Coordinates out of valid range'
            });
        }

        const nearest = await tallinnApi.findNearestStop(latitude, longitude);

        if (!nearest) {
            return res.status(404).json({
                success: false,
                error: 'No stops found'
            });
        }

        res.json({
            success: true,
            userLocation: {
                lat: latitude,
                lon: longitude
            },
            data: {
                stop_id: nearest.stopIds[0] || nearest.id,
                stop_code: nearest.id,
                stop_name: nearest.name,
                stop_desc: nearest.area,
                stop_lat: nearest.lat,
                stop_lon: nearest.lng,
                zone_id: nearest.city,
                region: nearest.area,
                distance_km: nearest.distance_km
            }
        });
    } catch (error) {
        console.error('Error finding nearest stop:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to find nearest stop'
        });
    }
});

module.exports = router;
