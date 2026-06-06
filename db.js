const pg = require('pg'); // Loads PostgreSQL client library for database connections.
const dotenv = require('dotenv'); // Loads dotenv to read variables from the .env file.

dotenv.config(); // Reads .env and puts values into process.env.

// PostgreSQL connection configuration
// Use environment variables for security
const pool = new pg.Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'placement_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

// Test the database connection
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Successfully connected to PostgreSQL database');
    release();
});

module.exports = pool; // Exports the pool so other files can use this database connection.
