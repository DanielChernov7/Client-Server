/**
 * Bus Stops Server
 * Main Express server for Estonia GTFS bus stops and arrivals
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { testConnection } = require('./src/db');

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
    const dbConnected = await testConnection();
    res.json({
        status: dbConnected ? 'healthy' : 'unhealthy',
        database: dbConnected ? 'connected' : 'disconnected',
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
    console.log('Bus Stops Server');
    console.log('========================================');

    // Test database connection
    console.log('\nTesting database connection...');
    const dbConnected = await testConnection();

    if (dbConnected) {
        console.log('Database connection successful.');
    } else {
        console.warn('WARNING: Database connection failed!');
        console.warn('Server will start but API calls may fail.');
        console.warn('Check your .env configuration and database access.');
    }

    app.listen(PORT, () => {
        console.log(`\nServer running on http://localhost:${PORT}`);
        console.log('Press Ctrl+C to stop.\n');
    });
}

start();
