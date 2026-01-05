/**
 * Nearest Stop API routes
 * GET /api/nearest - Returns nearest bus stop to given coordinates
 */

const express = require('express');
const router = express.Router();
const { query, table } = require('../db');

/**
 * GET /api/nearest
 * Query params:
 *   - lat: Latitude (required)
 *   - lon: Longitude (required)
 * Returns nearest stop with region info using Haversine formula
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

        // Use Haversine formula to find nearest stop
        // This calculates distance in kilometers
        const sql = `
            SELECT
                stop_id,
                stop_code,
                stop_name,
                stop_desc,
                stop_lat,
                stop_lon,
                zone_id,
                region,
                (
                    6371 * ACOS(
                        LEAST(1, GREATEST(-1,
                            COS(RADIANS(?)) *
                            COS(RADIANS(stop_lat)) *
                            COS(RADIANS(stop_lon) - RADIANS(?)) +
                            SIN(RADIANS(?)) *
                            SIN(RADIANS(stop_lat))
                        ))
                    )
                ) AS distance_km
            FROM ${table('stops')}
            WHERE stop_lat IS NOT NULL
              AND stop_lon IS NOT NULL
              AND stop_lat != 0
              AND stop_lon != 0
            ORDER BY distance_km ASC
            LIMIT 1
        `;

        const rows = await query(sql, [latitude, longitude, latitude]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No stops found'
            });
        }

        const nearest = rows[0];

        res.json({
            success: true,
            userLocation: {
                lat: latitude,
                lon: longitude
            },
            data: {
                stop_id: nearest.stop_id,
                stop_code: nearest.stop_code,
                stop_name: nearest.stop_name,
                stop_desc: nearest.stop_desc,
                stop_lat: parseFloat(nearest.stop_lat),
                stop_lon: parseFloat(nearest.stop_lon),
                zone_id: nearest.zone_id,
                region: nearest.region,
                distance_km: Math.round(nearest.distance_km * 1000) / 1000
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
