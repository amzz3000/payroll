const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: 'postgres://postgres:Youngboss3213!@localhost:5432/payroll'
});

module.exports = pool;
