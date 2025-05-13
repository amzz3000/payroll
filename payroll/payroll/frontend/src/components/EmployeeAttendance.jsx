import React, { useState, useEffect } from 'react';
import config from '../config';
import './EmployeeAttendance.css';

function EmployeeAttendance() {
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [message, setMessage] = useState('');
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const savedIn = localStorage.getItem(`attendanceIn_${today}`);
    const savedOut = localStorage.getItem(`attendanceOut_${today}`);
    if (savedIn) setInTime(savedIn);
    if (savedOut) setOutTime(savedOut);
  }, [today]);

  const handleInChange = (e) => {
    const value = e.target.value;
    setInTime(value);
    localStorage.setItem(`attendanceIn_${today}`, value);
  };

  const handleOutChange = (e) => {
    const value = e.target.value;
    setOutTime(value);
    localStorage.setItem(`attendanceOut_${today}`, value);
  };

  const handleSubmit = async () => {
    setMessage('');
    if (!inTime || !outTime) {
      setMessage('Please enter both In Time and Out Time.');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${config.API_URL}/employee/attendance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ inTime, outTime })
      });
      const data = await response.json();
      if (response.ok) {
        setMessage('Attendance submitted successfully!');
      } else {
        setMessage(data.error || 'Failed to submit attendance.');
      }
    } catch (err) {
      setMessage('Server error. Please try again later.');
    }
  };

  const handleReset = () => {
    setInTime('');
    setOutTime('');
    setMessage('');
    localStorage.removeItem(`attendanceIn_${today}`);
    localStorage.removeItem(`attendanceOut_${today}`);
  };

  return (
    <div className="attendance-container">
      <h2 className="attendance-title">📅 Attendance - {today}</h2>

      <div className="attendance-input-group">
        <label><strong>In Time:</strong></label>
        <input
          type="datetime-local"
          value={inTime}
          onChange={handleInChange}
        />
      </div>

      <div className="attendance-input-group">
        <label><strong>Out Time:</strong></label>
        <input
          type="datetime-local"
          value={outTime}
          onChange={handleOutChange}
          disabled={!inTime}
        />
      </div>

      <div className="attendance-actions">
        <button 
          className="submit-button"
          onClick={handleSubmit}
          disabled={!inTime || !outTime}
        >
          Submit Attendance
        </button>
        <button 
          className="reset-button" 
          onClick={handleReset}
          disabled={!inTime && !outTime}
        >
          Reset Attendance
        </button>
      </div>
      {message && <div className="attendance-message">{message}</div>}
    </div>
  );
}

export default EmployeeAttendance;
