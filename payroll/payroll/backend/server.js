require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Create SQLite database connection
const db = new sqlite3.Database(path.join(__dirname, 'payroll.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  
  // Create tables if they don't exist
  db.serialize(() => {
    // Admin table
    db.run(`CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )`);

    // Employee table
    db.run(`CREATE TABLE IF NOT EXISTS employee (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      password TEXT
    )`);

    // Leaves table
    db.run(`CREATE TABLE IF NOT EXISTS leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      date TEXT,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      FOREIGN KEY (employee_id) REFERENCES employee(id)
    )`);

    // Create default admin if not exists
    db.get("SELECT * FROM admin WHERE username = 'admin'", async (err, row) => {
      if (err) {
        console.error('Error checking admin:', err);
        return;
      }
      if (!row) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        db.run("INSERT INTO admin (username, password) VALUES (?, ?)", 
          ['admin', hashedPassword]);
      }
    });
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Payroll Management System API is running');
});

// Admin Login
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, admin) => {
    if (err) {
      console.error('Admin login error:', err);
      return res.status(500).json({ error: "Error during login" });
    }

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
  });
});

// Employee Login
app.post('/employee/login', async (req, res) => {
  const { email, password } = req.body;

  db.get('SELECT * FROM employee WHERE email = ?', [email], async (err, employee) => {
    if (err) {
      console.error('Employee login error:', err);
      return res.status(500).json({ error: "Error during login" });
    }

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
  });
});

// Employee Signup
app.post('/employee/signup', async (req, res) => {
  const { name, email, password, phone } = req.body;

  db.get('SELECT * FROM employee WHERE email = ?', [email], async (err, existingEmployee) => {
    if (err) {
      console.error('Signup error:', err);
      return res.status(500).json({ message: 'Error during registration' });
    }

    if (existingEmployee) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO employee (name, email, phone, password)
       VALUES (?, ?, ?, ?)`,
      [name, email, phone, hashedPassword],
      function(err) {
        if (err) {
          console.error('Signup error:', err);
          return res.status(500).json({ message: 'Error during registration' });
        }

        res.status(201).json({ 
          message: 'Employee registered successfully',
          employee: {
            id: this.lastID,
            name,
            email,
            phone
          }
        });
      }
    );
  });
});

// Get employee count
app.get('/api/employees/count', verifyToken('admin'), (req, res) => {
  db.get('SELECT COUNT(*) as count FROM employee', (err, result) => {
    if (err) {
      console.error('Error fetching employee count:', err);
      return res.status(500).json({ error: 'Failed to fetch employee count' });
    }
    res.json({ count: result.count });
  });
});

// Get all employees
app.get('/employees', verifyToken('admin'), (req, res) => {
  db.all('SELECT id, name, email, phone FROM employee ORDER BY id', (err, rows) => {
    if (err) {
      console.error('Error fetching employees:', err);
      return res.status(500).json({ error: 'Failed to fetch employees' });
    }
    res.json(rows);
  });
});

// Add new employee
app.post('/employees', verifyToken('admin'), async (req, res) => {
  const { name, email, phone, password } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);
  
  db.run(
    `INSERT INTO employee (name, email, phone, password)
     VALUES (?, ?, ?, ?)`,
    [name, email, phone, hashedPassword],
    function(err) {
      if (err) {
        console.error('Error adding employee:', err);
        return res.status(500).json({ error: 'Failed to add employee' });
      }

      res.status(201).json({
        id: this.lastID,
        name,
        email,
        phone
      });
    }
  );
});

// Get pending leave requests
app.get('/api/leave-requests/pending', verifyToken('admin'), (req, res) => {
  db.all(`
    SELECT l.*, e.name as employee_name, e.email as employee_email 
    FROM leaves l 
    JOIN employee e ON l.employee_id = e.id 
    WHERE l.status = 'Pending'
    ORDER BY l.date DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching pending leaves:', err);
      return res.status(500).json({ error: 'Failed to fetch pending leaves' });
    }
    res.json(rows);
  });
});

// Update leave request status
app.put('/leaves/:id/status', verifyToken('admin'), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.run(
    'UPDATE leaves SET status = ? WHERE id = ?',
    [status, id],
    function(err) {
      if (err) {
        console.error('Error updating leave status:', err);
        return res.status(500).json({ error: 'Failed to update leave status' });
      }
      res.json({ message: 'Leave status updated successfully' });
    }
  );
});

// Get employee's leave requests
app.get('/leave-requests/employee', verifyToken('employee'), (req, res) => {
  db.all(
    'SELECT * FROM leaves WHERE employee_id = ? ORDER BY date DESC',
    [req.user.id],
    (err, rows) => {
      if (err) {
        console.error('Error fetching employee leaves:', err);
        return res.status(500).json({ error: 'Failed to fetch leave requests' });
      }
      res.json(rows);
    }
  );
});

// Submit new leave request
app.post('/leave-requests', verifyToken('employee'), (req, res) => {
  const { date, reason } = req.body;
  const employee_id = req.user.id;

  db.run(
    'INSERT INTO leaves (employee_id, date, reason) VALUES (?, ?, ?)',
    [employee_id, date, reason],
    function(err) {
      if (err) {
        console.error('Error submitting leave request:', err);
        return res.status(500).json({ error: 'Failed to submit leave request' });
      }
      res.status(201).json({ 
        message: 'Leave request submitted successfully',
        id: this.lastID
      });
    }
  );
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