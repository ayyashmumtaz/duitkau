const fs = require('fs');
const path = require('path');
const db = require('../database');

const logFilePath = path.join(__dirname, '../logs/events.txt');

// Pastikan folder logs ada
if (!fs.existsSync(path.dirname(logFilePath))) {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

/**
 * Mencatat aktivitas ke dalam file events.txt
 * @param {object} req - Express request object (untuk ambil session)
 * @param {string} action - Tipe aksi (CREATE, UPDATE, DELETE)
 * @param {string} details - Penjelasan detail dari aksi tersebut
 */
function logEvent(req, action, details) {
  const timestamp = new Date().toISOString();
  
  // Mengambil informasi dari sesi user jika ada
  let username = 'System';
  let role = 'System';
  let ip = req.ip || req.connection.remoteAddress || 'Unknown';

  if (req && req.session) {
    if (req.session.username) username = req.session.username;
    if (req.session.role) role = req.session.role;
  }

  // Format log: [WAKTU] [ROLE:USERNAME] (IP) | AKSI | DETAIL
  const logLine = `[${timestamp}] [${role.toUpperCase()}:${username}] (${ip}) | ${action} | ${details}\n`;
  
  // Tambah baris ke log secara async (tidak memblokir server req)
  fs.appendFile(logFilePath, logLine, (err) => {
    if (err) console.error('Gagal menulis event log:', err);
  });

  // Catat juga ke Database
  if (db.isConnected()) {
    db.runAsync(
      `INSERT INTO event_logs (username, role, ip, action, details) VALUES (?, ?, ?, ?, ?)`,
      [username, role, ip, action, details]
    ).catch(err => console.error('Gagal menulis log ke DB:', err.message));
  }
}

function getLogContent() {
  try {
    if (!fs.existsSync(logFilePath)) return '';
    return fs.readFileSync(logFilePath, 'utf8');
  } catch (err) {
    return 'Gagal membaca file log. Hubungi administrator.';
  }
}

function getLogPath() {
  return logFilePath;
}

module.exports = {
  logEvent,
  getLogContent,
  getLogPath
};
