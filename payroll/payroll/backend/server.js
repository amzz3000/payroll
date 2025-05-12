require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Admin table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
      )
    `);

    // Employee table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT,
        password TEXT
      )
    `);

    // Leaves table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaves (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employee(id),
        date TEXT,
        reason TEXT,
        status TEXT DEFAULT 'Pending'
      )
    `);

    // Create default admin if not exists
    const adminCheck = await pool.query("SELECT * FROM admin WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO admin (username, password) VALUES ($1, $2)",
        ['admin', hashedPassword]
      );
    }

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

initializeDatabase();

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Payroll Management System API is running');
});

// Admin Login
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
    const admin = result.rows[0];

    if (!admin) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: 'admin' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({ 
      message: 'Login successful', 
      token,
      role: 'admin',
      user: {
        id: admin.id,
        username: admin.username
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: "Error during login" });
  }
});

// Employee Login
app.post('/employee/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM employee WHERE email = $1', [email]);
    const employee = result.rows[0];

    if (!employee) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, employee.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { 
        id: employee.id, 
        email: employee.email, 
        role: 'employee' 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({ 
      message: 'Login successful', 
      token,
      role: 'employee',
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone
      }
    });
  } catch (err) {
    console.error('Employee login error:', err);
    res.status(500).json({ error: "Error during login" });
  }
});

// Employee Signup
app.post('/employee/signup', async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {
    const checkResult = await pool.query('SELECT * FROM employee WHERE email = $1', [email]);
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO employee (name, email, phone, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone`,
      [name, email, phone, hashedPassword]
    );

    res.status(201).json({ 
      message: 'Employee registered successfully',
      employee: result.rows[0]
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Error during registration' });
  }
});

// Get employee count
app.get('/api/employees/count', verifyToken('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM employee');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Error fetching employee count:', err);
    res.status(500).json({ error: 'Failed to fetch employee count' });
  }
});

// Get all employees
app.get('/employees', verifyToken('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone FROM employee ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// Add new employee
app.post('/employees', verifyToken('admin'), async (req, res) => {
  const { name, email, phone, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO employee (name, email, phone, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone`,
      [name, email, phone, hashedPassword]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding employee:', err);
    res.status(500).json({ error: 'Failed to add employee' });
  }
});

// Get pending leave requests
app.get('/api/leave-requests/pending', verifyToken('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, e.name as employee_name, e.email as employee_email 
      FROM leaves l 
      JOIN employee e ON l.employee_id = e.id 
      WHERE l.status = 'Pending'
      ORDER BY l.date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending leaves:', err);
    res.status(500).json({ error: 'Failed to fetch pending leaves' });
  }
});

// Update leave request status
app.put('/leaves/:id/status', verifyToken('admin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await pool.query(
      'UPDATE leaves SET status = $1 WHERE id = $2',
      [status, id]
    );
    res.json({ message: 'Leave status updated successfully' });
  } catch (err) {
    console.error('Error updating leave status:', err);
    res.status(500).json({ error: 'Failed to update leave status' });
  }
});

// Get employee's leave requests
app.get('/leave-requests/employee', verifyToken('employee'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM leaves WHERE employee_id = $1 ORDER BY date DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching employee leaves:', err);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// Submit new leave request
app.post('/leave-requests', verifyToken('employee'), async (req, res) => {
  const { date, reason } = req.body;
  const employee_id = req.user.id;

  try {
    const result = await pool.query(
      'INSERT INTO leaves (employee_id, date, reason) VALUES ($1, $2, $3) RETURNING id',
      [employee_id, date, reason]
    );
    res.status(201).json({ 
      message: 'Leave request submitted successfully',
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('Error submitting leave request:', err);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// Token verification middleware
function verifyToken(requiredRole) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      if (decoded.role !== requiredRole) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});