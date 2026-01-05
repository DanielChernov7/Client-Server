/**
 * Database connection module
 * Provides MySQL connection pool and helper functions
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'busstops',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

const TABLE_PREFIX = process.env.TABLE_PREFIX || 'danil_';

/**
 * Get table name with prefix
 * @param {string} name - Base table name
 * @returns {string} Prefixed table name
 */
function table(name) {
    return `${TABLE_PREFIX}${name}`;
}

/**
 * Execute a query with parameters
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Query results
 */
async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

/**
 * Get a connection from the pool
 * @returns {Promise<Connection>} Database connection
 */
async function getConnection() {
    return pool.getConnection();
}

/**
 * Test database connection
 * @returns {Promise<boolean>} Connection status
 */
async function testConnection() {
    try {
        await pool.execute('SELECT 1');
        return true;
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    query,
    getConnection,
    testConnection,
    table,
    TABLE_PREFIX
};
