/**
 * Tallinn Bus Stops Server
 * Express server using transport.tallinn.ee API
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const regionsRouter = require('./src/routes/regions');
const stopsRouter = require('./src/routes/stops');
const busesRouter = require('./src/routes/buses');
const nearestRouter = require('./src/routes/nearest');
const arrivalsRouter = require('./src/routes/arrivals');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// API Routes
app.use('/api/regions', regionsRouter);
app.use('/api/stops', stopsRouter);
app.use('/api/buses', busesRouter);
app.use('/api/nearest', nearestRouter);
app.use('/api/arrivals', arrivalsRouter);

// Health check endpoint
app.get('/api/health', async (req, res) => {
    res.json({
        status: 'healthy',
        source: 'transport.tallinn.ee',
        timestamp: new Date().toISOString()
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
async function start() {
    console.log('========================================');
    console.log('Tallinn Bus Stops Server');
    console.log('Using transport.tallinn.ee API');
    console.log('========================================');

    app.listen(PORT, () => {
        console.log(`\nServer running on http://localhost:${PORT}`);
        console.log('Press Ctrl+C to stop.\n');
    });
}

start();
