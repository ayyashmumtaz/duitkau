const fs   = require('fs');
const path = require('path');
const db   = require('../database');

const LOG_DIR      = path.join(__dirname, '../logs');
const LOG_FILE     = path.join(LOG_DIR, 'events.txt');
const MAX_BYTES    = 5 * 1024 * 1024; // 5 MB per file
const MAX_ARCHIVES = 5;               // simpan events.1.txt … events.5.txt

// Pastikan folder logs ada
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Rotate: events.4.txt → events.5.txt, ..., events.txt → events.1.txt
 * File ke-MAX_ARCHIVES+1 dibuang.
 */
function rotateLogs() {
  // Hapus arsip tertua dulu
  const oldest = path.join(LOG_DIR, `events.${MAX_ARCHIVES}.txt`);
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);

  // Shift arsip: N-1 → N
  for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
    const src = path.join(LOG_DIR, `events.${i}.txt`);
    const dst = path.join(LOG_DIR, `events.${i + 1}.txt`);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }

  // events.txt → events.1.txt
  if (fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'events.1.txt'));
}

function needsRotation() {
  try {
    return fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size >= MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * Mencatat aktivitas ke events.txt + database.
 * @param {object} req     - Express request object
 * @param {string} action  - Tipe aksi (CREATE, UPDATE, DELETE, …)
 * @param {string} details - Penjelasan detail
 */
function logEvent(req, action, details) {
  const timestamp = new Date().toISOString();

  let username = 'System';
  let role     = 'System';
  let ip       = req?.ip || req?.connection?.remoteAddress || 'Unknown';

  if (req?.session) {
    if (req.session.username) username = req.session.username;
    if (req.session.role)     role     = req.session.role;
  }

  const logLine = `[${timestamp}] [${role.toUpperCase()}:${username}] (${ip}) | ${action} | ${details}\n`;

  // Rotate jika perlu, lalu tulis
  try {
    if (needsRotation()) rotateLogs();
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    console.error('Gagal menulis event log:', err);
  }

  // Catat juga ke database
  if (db.isConnected()) {
    db.runAsync(
      `INSERT INTO event_logs (username, role, ip, action, details) VALUES (?, ?, ?, ?, ?)`,
      [username, role, ip, action, details]
    ).catch(err => console.error('Gagal menulis log ke DB:', err.message));

    // Prune setiap 100 writes agar tabel tidak numpuk
    if (++_writeCount % 100 === 0) pruneEventLogs();
  }
}

/** Baca isi log aktif (events.txt). */
function getLogContent() {
  try {
    if (!fs.existsSync(LOG_FILE)) return '';
    return fs.readFileSync(LOG_FILE, 'utf8');
  } catch {
    return 'Gagal membaca file log. Hubungi administrator.';
  }
}

/**
 * Daftar semua file log (aktif + arsip), dari yang terbaru.
 * @returns {{ name: string, path: string, sizeKB: number }[]}
 */
function listLogFiles() {
  const files = [{ name: 'events.txt', filePath: LOG_FILE }];
  for (let i = 1; i <= MAX_ARCHIVES; i++) {
    const fp = path.join(LOG_DIR, `events.${i}.txt`);
    if (fs.existsSync(fp)) files.push({ name: `events.${i}.txt`, filePath: fp });
  }
  return files.map(f => ({
    name:   f.name,
    path:   f.filePath,
    sizeKB: fs.existsSync(f.filePath) ? Math.round(fs.statSync(f.filePath).size / 1024) : 0,
  }));
}

function getLogPath() { return LOG_FILE; }

// ── DB pruning ────────────────────────────────────────────────
const PRUNE_DAYS     = 90;    // hapus log lebih dari 90 hari
const PRUNE_MAX_ROWS = 50000; // hard cap total baris
let   _writeCount    = 0;

async function pruneEventLogs() {
  if (!db.isConnected()) return;
  try {
    // 1. Hapus yang lebih tua dari PRUNE_DAYS hari
    await db.runAsync(
      `DELETE FROM event_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [PRUNE_DAYS]
    );
    // 2. Hard cap: kalau masih > PRUNE_MAX_ROWS, hapus yang terlama
    const row = await db.getAsync('SELECT COUNT(*) as n FROM event_logs');
    if (row.n > PRUNE_MAX_ROWS) {
      await db.runAsync(
        `DELETE FROM event_logs ORDER BY id ASC LIMIT ?`,
        [row.n - PRUNE_MAX_ROWS]
      );
    }
  } catch (err) {
    console.error('Gagal prune event_logs:', err.message);
  }
}

// Jalankan saat modul pertama kali dimuat (startup)
pruneEventLogs();

module.exports = { logEvent, getLogContent, getLogPath, listLogFiles, pruneEventLogs };
