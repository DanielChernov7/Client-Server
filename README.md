# Bussipeatused - Estonia Bus Stops & Arrivals

A web application for viewing Estonia bus stops and arrival times using GTFS data from peatus.ee.

## Features

- **Region Selection**: Autocomplete combobox for selecting Estonian regions
- **Stop Selection**: Autocomplete combobox for selecting bus stops within a region
- **Bus Routes**: View all bus routes serving a selected stop (naturally sorted: 2, 9, 10, 10A, 11, 100)
- **Arrival Times**: View next 5 arrival times for a selected bus at a stop
- **Geolocation**: Automatic detection of nearest bus stop based on user's location
- **Direction Info**: Shows trip headsign and direction for arrivals
- **Date Handling**: Correctly handles arrivals past midnight (shows "Today"/"Tomorrow")

## Project Structure

```
repo/
├── server/
│   ├── src/
│   │   ├── db.js                 # Database connection module
│   │   ├── gtfs_import.js        # GTFS data importer
│   │   └── routes/
│   │       ├── regions.js        # GET /api/regions
│   │       ├── stops.js          # GET /api/stops
│   │       ├── buses.js          # GET /api/buses
│   │       ├── nearest.js        # GET /api/nearest
│   │       └── arrivals.js       # GET /api/arrivals
│   ├── index.js                  # Express server entry point
│   ├── package.json
│   └── .env.example
├── client/
│   ├── index.html                # Single page application
│   ├── app.js                    # Client-side JavaScript
│   └── styles.css                # Custom styles
└── README.md
```

## Prerequisites

- Node.js >= 18.0.0
- MySQL 5.7+ or MariaDB 10.3+
- Internet connection (for downloading GTFS data)

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
# Remote database (university)
DB_HOST=d26893.mysql.zonevs.eu
DB_USER=d26893_busstops
DB_PASSWORD=3w7PYquFJhver0!KdOfF
DB_NAME=d26893_busstops

# Your table prefix (use your name)
TABLE_PREFIX=danil_

# Server port
PORT=3000
```

**For local MySQL:**
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=busstops
```

### 3. Database Access

**Important**: The remote database requires your IP to be allowlisted. If connecting from university:
- Use the university VPN or
- Request IP allowlisting from the database administrator

### 4. Import GTFS Data

Download and import Estonia GTFS data into the database:

```bash
npm run import:gtfs
```

This will:
1. Download `gtfs.zip` from peatus.ee
2. Extract stops.txt, routes.txt, trips.txt, stop_times.txt, calendar.txt, calendar_dates.txt
3. Create database tables with your prefix (e.g., `danil_stops`)
4. Import all data (this may take 5-15 minutes depending on your connection)

### 5. Start the Server

```bash
npm start
```

The server will start at `http://localhost:3000`

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### GET /api/regions
Returns list of distinct regions.

**Response:**
```json
{
  "success": true,
  "count": 150,
  "data": ["Tallinn", "Tartu", "Pärnu", ...]
}
```

### GET /api/stops?region={region}
Returns stops in a region.

**Parameters:**
- `region` (required): Region name

**Response:**
```json
{
  "success": true,
  "region": "Tallinn",
  "count": 500,
  "data": [
    {
      "stop_id": "1234",
      "stop_code": "A1234",
      "stop_name": "Balti jaam",
      "stop_lat": 59.4400,
      "stop_lon": 24.7373,
      "region": "Tallinn"
    }
  ]
}
```

### GET /api/buses?stopId={stopId}
Returns bus routes serving a stop.

**Parameters:**
- `stopId` (required): Stop ID

**Response:**
```json
{
  "success": true,
  "stopId": "1234",
  "count": 10,
  "data": ["1", "2", "10", "10A", "17", "23"]
}
```

### GET /api/nearest?lat={lat}&lon={lon}
Returns nearest stop to coordinates.

**Parameters:**
- `lat` (required): Latitude
- `lon` (required): Longitude

**Response:**
```json
{
  "success": true,
  "userLocation": { "lat": 59.437, "lon": 24.745 },
  "data": {
    "stop_id": "1234",
    "stop_name": "Viru keskus",
    "region": "Tallinn",
    "distance_km": 0.156
  }
}
```

### GET /api/arrivals?stopId={stopId}&route={route}
Returns next 5 arrivals for a route at a stop.

**Parameters:**
- `stopId` (required): Stop ID
- `route` (required): Route short name (e.g., "10A")

**Response:**
```json
{
  "success": true,
  "stop": {
    "stop_id": "1234",
    "stop_name": "Balti jaam",
    "stop_code": "A1234",
    "stop_lat": 59.4400,
    "stop_lon": 24.7373
  },
  "route": "10A",
  "currentTime": "14:30:25",
  "currentDate": "2024-01-15",
  "count": 5,
  "data": [
    {
      "time": "14:35",
      "dateLabel": "Täna",
      "date": "20240115",
      "headsign": "Kopli",
      "direction": 0
    }
  ]
}
```

## Database Schema

Tables are created with your configured prefix (e.g., `danil_`):

- `{prefix}stops` - Bus stop locations and metadata
- `{prefix}routes` - Bus route definitions
- `{prefix}trips` - Trip information with headsign and direction
- `{prefix}stop_times` - Arrival/departure times at each stop
- `{prefix}calendar` - Service schedule (weekdays)
- `{prefix}calendar_dates` - Service exceptions (holidays)

## Region Extraction

The "region" field is derived from GTFS data:
1. Primary: `stop_desc` field (often contains municipality name)
2. Fallback: Parsed from `stop_name` patterns
3. Last resort: `zone_id` field

This is a heuristic approach since GTFS doesn't have a standardized "region" field.

## Technical Notes

### Natural Sorting
Bus routes are sorted naturally: 1, 2, 9, 10, 10A, 11, 100, 100A (not alphabetically: 1, 10, 100, 2)

### Arrival Time Handling
GTFS times can exceed 24:00:00 for trips crossing midnight. The application:
- Parses "25:30:00" as 01:30 the next day
- Shows appropriate date labels ("Täna"/"Homme")
- Considers active services based on calendar and calendar_dates

### Timezone
All time calculations use Europe/Tallinn timezone.

## Troubleshooting

### Database Connection Failed
- Check your IP is allowlisted for remote database
- Verify credentials in `.env`
- Try connecting from university network/VPN

### Import Fails
- Ensure stable internet connection
- Check disk space for temp files
- Try running import again (it will recreate tables)

### No Arrivals Found
- Verify the route serves the selected stop
- Check if service is active today (weekday/weekend/holiday)
- Calendar data may be outdated - re-import GTFS

## Technologies

- **Backend**: Node.js, Express
- **Database**: MySQL with mysql2 driver
- **Frontend**: HTML5, Bootstrap 5, jQuery UI Autocomplete
- **Data**: Estonia GTFS from peatus.ee

## License

Educational project for TalTech Client-Server course.
