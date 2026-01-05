/**
 * GTFS Data Importer
 * Downloads Estonia GTFS data and imports it into MySQL
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse');
const { pool, table, getConnection, TABLE_PREFIX } = require('./db');
require('dotenv').config();

const GTFS_URL = process.env.GTFS_URL || 'https://peatus.ee/gtfs/gtfs.zip';
const TEMP_DIR = path.join(__dirname, '../temp');
const CHUNK_SIZE = 1000; // Rows per bulk insert

/**
 * Download file from URL
 * @param {string} url - URL to download
 * @param {string} dest - Destination path
 * @returns {Promise<void>}
 */
async function downloadFile(url, dest, baseUrl = null) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading from ${url}...`);
        const file = fs.createWriteStream(dest);
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                // Follow redirect
                file.close();
                try { fs.unlinkSync(dest); } catch(e) {}
                let redirectUrl = response.headers.location;
                // Handle relative redirects
                if (redirectUrl.startsWith('/')) {
                    const urlObj = new URL(url);
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                downloadFile(redirectUrl, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if (totalSize) {
                    const percent = ((downloaded / totalSize) * 100).toFixed(1);
                    process.stdout.write(`\rDownloading: ${percent}%`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log('\nDownload complete.');
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

/**
 * Parse CSV file and return records
 * @param {string} filePath - Path to CSV file
 * @returns {Promise<Array>} Parsed records
 */
async function parseCSV(filePath) {
    return new Promise((resolve, reject) => {
        const records = [];
        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relaxQuotes: true,
            relaxColumnCount: true
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
            }
        });

        parser.on('error', reject);
        parser.on('end', () => resolve(records));

        fs.createReadStream(filePath).pipe(parser);
    });
}

/**
 * Extract region from stop_desc or stop_name
 * @param {object} stop - Stop record
 * @returns {string} Extracted region
 */
function extractRegion(stop) {
    // Try stop_desc first - often contains municipality name
    if (stop.stop_desc) {
        const desc = stop.stop_desc.trim();
        // Common patterns: "City name", "Municipality, area", etc.
        if (desc.includes(',')) {
            return desc.split(',')[0].trim();
        }
        if (desc) return desc;
    }

    // Fallback: extract from stop_name if it contains area info
    if (stop.stop_name) {
        const name = stop.stop_name.trim();
        // Some stops have format "Area - Stop Name" or "Area/Stop Name"
        if (name.includes(' - ')) {
            return name.split(' - ')[0].trim();
        }
    }

    // Last resort: use zone_id if available
    if (stop.zone_id) {
        return stop.zone_id;
    }

    return 'Unknown';
}

/**
 * Create database tables
 * @param {Connection} conn - Database connection
 */
async function createTables(conn) {
    console.log('Creating tables...');

    // Stops table with region column
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('stops')} (
            stop_id VARCHAR(50) PRIMARY KEY,
            stop_code VARCHAR(50),
            stop_name VARCHAR(255) NOT NULL,
            stop_desc TEXT,
            stop_lat DECIMAL(10, 7),
            stop_lon DECIMAL(10, 7),
            zone_id VARCHAR(50),
            stop_url VARCHAR(255),
            location_type INT DEFAULT 0,
            parent_station VARCHAR(50),
            stop_timezone VARCHAR(50),
            wheelchair_boarding INT DEFAULT 0,
            region VARCHAR(255),
            INDEX idx_region (region),
            INDEX idx_stop_name (stop_name),
            INDEX idx_stop_lat_lon (stop_lat, stop_lon)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Routes table
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('routes')} (
            route_id VARCHAR(50) PRIMARY KEY,
            agency_id VARCHAR(50),
            route_short_name VARCHAR(50),
            route_long_name VARCHAR(255),
            route_type INT,
            route_color VARCHAR(10),
            route_text_color VARCHAR(10),
            INDEX idx_route_short_name (route_short_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Trips table
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('trips')} (
            trip_id VARCHAR(100) PRIMARY KEY,
            route_id VARCHAR(50) NOT NULL,
            service_id VARCHAR(50) NOT NULL,
            trip_headsign VARCHAR(255),
            trip_short_name VARCHAR(50),
            direction_id INT DEFAULT 0,
            block_id VARCHAR(50),
            shape_id VARCHAR(50),
            wheelchair_accessible INT DEFAULT 0,
            bikes_allowed INT DEFAULT 0,
            INDEX idx_route_id (route_id),
            INDEX idx_service_id (service_id),
            INDEX idx_route_service (route_id, service_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Stop times table
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('stop_times')} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            trip_id VARCHAR(100) NOT NULL,
            arrival_time VARCHAR(10),
            departure_time VARCHAR(10),
            stop_id VARCHAR(50) NOT NULL,
            stop_sequence INT NOT NULL,
            stop_headsign VARCHAR(255),
            pickup_type INT DEFAULT 0,
            drop_off_type INT DEFAULT 0,
            INDEX idx_stop_id (stop_id),
            INDEX idx_trip_id (trip_id),
            INDEX idx_stop_arrival (stop_id, arrival_time),
            INDEX idx_trip_stop (trip_id, stop_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Calendar table
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('calendar')} (
            service_id VARCHAR(50) PRIMARY KEY,
            monday INT NOT NULL,
            tuesday INT NOT NULL,
            wednesday INT NOT NULL,
            thursday INT NOT NULL,
            friday INT NOT NULL,
            saturday INT NOT NULL,
            sunday INT NOT NULL,
            start_date VARCHAR(10) NOT NULL,
            end_date VARCHAR(10) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Calendar dates table (exceptions)
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS ${table('calendar_dates')} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            service_id VARCHAR(50) NOT NULL,
            date VARCHAR(10) NOT NULL,
            exception_type INT NOT NULL,
            INDEX idx_service_id (service_id),
            INDEX idx_date (date),
            UNIQUE KEY unique_service_date (service_id, date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Tables created successfully.');
}

/**
 * Bulk insert records into table
 * @param {Connection} conn - Database connection
 * @param {string} tableName - Table name
 * @param {Array} records - Records to insert
 * @param {Array} columns - Column names
 */
async function bulkInsert(conn, tableName, records, columns) {
    if (records.length === 0) return;

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT IGNORE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);

        for (const record of chunk) {
            const values = columns.map(col => record[col] ?? null);
            await conn.execute(sql, values);
        }

        const percent = Math.min(100, ((i + chunk.length) / records.length * 100)).toFixed(1);
        process.stdout.write(`\rInserting into ${tableName}: ${percent}%`);
    }
    console.log();
}

/**
 * Bulk insert with batch execution
 * @param {Connection} conn - Database connection
 * @param {string} tableName - Table name
 * @param {Array} records - Records to insert
 * @param {Array} columns - Column names
 */
async function bulkInsertBatch(conn, tableName, records, columns) {
    if (records.length === 0) return;

    const BATCH_SIZE = 100;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const chunk = records.slice(i, i + BATCH_SIZE);

        const placeholderRow = `(${columns.map(() => '?').join(', ')})`;
        const placeholders = chunk.map(() => placeholderRow).join(', ');
        const sql = `INSERT IGNORE INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders}`;

        const values = [];
        for (const record of chunk) {
            for (const col of columns) {
                values.push(record[col] ?? null);
            }
        }

        await conn.execute(sql, values);

        const percent = Math.min(100, ((i + chunk.length) / records.length * 100)).toFixed(1);
        process.stdout.write(`\rInserting into ${tableName}: ${percent}%`);
    }
    console.log();
}

/**
 * Import stops data
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to stops.txt
 */
async function importStops(conn, filePath) {
    console.log('Parsing stops.txt...');
    const records = await parseCSV(filePath);
    console.log(`Found ${records.length} stops.`);

    const columns = [
        'stop_id', 'stop_code', 'stop_name', 'stop_desc',
        'stop_lat', 'stop_lon', 'zone_id', 'stop_url',
        'location_type', 'parent_station', 'stop_timezone',
        'wheelchair_boarding', 'region'
    ];

    // Add region to each record
    const processedRecords = records.map(record => ({
        ...record,
        region: extractRegion(record)
    }));

    await bulkInsertBatch(conn, table('stops'), processedRecords, columns);
}

/**
 * Import routes data
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to routes.txt
 */
async function importRoutes(conn, filePath) {
    console.log('Parsing routes.txt...');
    const records = await parseCSV(filePath);
    console.log(`Found ${records.length} routes.`);

    const columns = [
        'route_id', 'agency_id', 'route_short_name',
        'route_long_name', 'route_type', 'route_color', 'route_text_color'
    ];

    await bulkInsertBatch(conn, table('routes'), records, columns);
}

/**
 * Import trips data
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to trips.txt
 */
async function importTrips(conn, filePath) {
    console.log('Parsing trips.txt...');
    const records = await parseCSV(filePath);
    console.log(`Found ${records.length} trips.`);

    const columns = [
        'trip_id', 'route_id', 'service_id', 'trip_headsign',
        'trip_short_name', 'direction_id', 'block_id', 'shape_id',
        'wheelchair_accessible', 'bikes_allowed'
    ];

    await bulkInsertBatch(conn, table('trips'), records, columns);
}

/**
 * Import stop_times data (this is the largest file)
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to stop_times.txt
 */
async function importStopTimes(conn, filePath) {
    console.log('Parsing stop_times.txt (this may take a while)...');

    const columns = [
        'trip_id', 'arrival_time', 'departure_time', 'stop_id',
        'stop_sequence', 'stop_headsign', 'pickup_type', 'drop_off_type'
    ];

    // Stream parse for large files
    return new Promise((resolve, reject) => {
        const records = [];
        let count = 0;
        const BATCH_SIZE = 5000;

        const parser = parse({
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relaxQuotes: true,
            relaxColumnCount: true
        });

        parser.on('readable', async () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
                count++;

                if (records.length >= BATCH_SIZE) {
                    parser.pause();
                    try {
                        const batch = records.splice(0, records.length);
                        await insertStopTimesBatch(conn, batch, columns);
                        process.stdout.write(`\rProcessed ${count} stop_times...`);
                    } catch (err) {
                        console.error('Error inserting batch:', err);
                    }
                    parser.resume();
                }
            }
        });

        parser.on('error', reject);

        parser.on('end', async () => {
            // Insert remaining records
            if (records.length > 0) {
                await insertStopTimesBatch(conn, records, columns);
            }
            console.log(`\nImported ${count} stop_times.`);
            resolve();
        });

        fs.createReadStream(filePath).pipe(parser);
    });
}

/**
 * Insert batch of stop_times
 * @param {Connection} conn - Database connection
 * @param {Array} records - Records to insert
 * @param {Array} columns - Column names
 */
async function insertStopTimesBatch(conn, records, columns) {
    if (records.length === 0) return;

    const MINI_BATCH = 500;

    for (let i = 0; i < records.length; i += MINI_BATCH) {
        const chunk = records.slice(i, i + MINI_BATCH);

        const placeholderRow = `(${columns.map(() => '?').join(', ')})`;
        const placeholders = chunk.map(() => placeholderRow).join(', ');
        const sql = `INSERT IGNORE INTO ${table('stop_times')} (${columns.join(', ')}) VALUES ${placeholders}`;

        const values = [];
        for (const record of chunk) {
            for (const col of columns) {
                values.push(record[col] ?? null);
            }
        }

        await conn.execute(sql, values);
    }
}

/**
 * Import calendar data
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to calendar.txt
 */
async function importCalendar(conn, filePath) {
    if (!fs.existsSync(filePath)) {
        console.log('calendar.txt not found, skipping...');
        return;
    }

    console.log('Parsing calendar.txt...');
    const records = await parseCSV(filePath);
    console.log(`Found ${records.length} calendar entries.`);

    const columns = [
        'service_id', 'monday', 'tuesday', 'wednesday',
        'thursday', 'friday', 'saturday', 'sunday',
        'start_date', 'end_date'
    ];

    await bulkInsertBatch(conn, table('calendar'), records, columns);
}

/**
 * Import calendar_dates data
 * @param {Connection} conn - Database connection
 * @param {string} filePath - Path to calendar_dates.txt
 */
async function importCalendarDates(conn, filePath) {
    if (!fs.existsSync(filePath)) {
        console.log('calendar_dates.txt not found, skipping...');
        return;
    }

    console.log('Parsing calendar_dates.txt...');
    const records = await parseCSV(filePath);
    console.log(`Found ${records.length} calendar date exceptions.`);

    const columns = ['service_id', 'date', 'exception_type'];

    await bulkInsertBatch(conn, table('calendar_dates'), records, columns);
}

/**
 * Clear existing tables
 * @param {Connection} conn - Database connection
 */
async function clearTables(conn) {
    console.log('Clearing existing data...');
    const tables = ['stop_times', 'trips', 'routes', 'calendar_dates', 'calendar', 'stops'];
    for (const t of tables) {
        try {
            await conn.execute(`DROP TABLE IF EXISTS ${table(t)}`);
        } catch (e) {
            // Ignore errors
        }
    }
}

/**
 * Main import function
 */
async function main() {
    console.log('========================================');
    console.log('GTFS Data Importer');
    console.log(`Table prefix: ${TABLE_PREFIX}`);
    console.log('========================================\n');

    // Create temp directory
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const zipPath = path.join(TEMP_DIR, 'gtfs.zip');
    const extractDir = path.join(TEMP_DIR, 'gtfs');

    let conn;

    try {
        // Download GTFS zip
        await downloadFile(GTFS_URL, zipPath);

        // Extract zip
        console.log('Extracting zip file...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
        console.log('Extraction complete.\n');

        // Connect to database
        console.log('Connecting to database...');
        conn = await getConnection();
        console.log('Connected.\n');

        // Clear and create tables
        await clearTables(conn);
        await createTables(conn);

        // Import data
        console.log('\n--- Importing GTFS Data ---\n');

        await importStops(conn, path.join(extractDir, 'stops.txt'));
        await importRoutes(conn, path.join(extractDir, 'routes.txt'));
        await importTrips(conn, path.join(extractDir, 'trips.txt'));
        await importCalendar(conn, path.join(extractDir, 'calendar.txt'));
        await importCalendarDates(conn, path.join(extractDir, 'calendar_dates.txt'));
        await importStopTimes(conn, path.join(extractDir, 'stop_times.txt'));

        console.log('\n========================================');
        console.log('Import completed successfully!');
        console.log('========================================');

    } catch (error) {
        console.error('\nImport failed:', error);
        process.exit(1);
    } finally {
        if (conn) conn.release();

        // Cleanup temp files
        console.log('\nCleaning up temporary files...');
        try {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        } catch (e) {
            console.log('Note: Could not remove temp directory');
        }

        process.exit(0);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { main };
