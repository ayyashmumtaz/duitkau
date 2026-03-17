'use strict';

const express = require('express');
const db      = require('../database');
const { logEvent } = require('../utils/logger');

let mysql;
try { mysql = require('mysql2/promise'); } catch {}

const router = express.Router();

// Allow when DB not connected (initial setup) OR super_admin session
router.use((req, res, next) => {
  if (!db.isConnected()) return next();
  if (req.session?.role === 'super_admin') return next();
  return res.status(403).json({ error: 'Akses ditolak — hanya Super Admin' });
});

// GET /api/settings/db — current config (password masked)
router.get('/db', (req, res) => {
  const cfg = db.loadConfig();
  res.json({
    host:        cfg.host        || '',
    port:        cfg.port        || 3306,
    user:        cfg.user        || '',
    hasPassword: !!(cfg.password),
    database:    cfg.database    || '',
    connected:   db.isConnected(),
  });
});

// POST /api/settings/db/test — test connection without saving
router.post('/db/test', async (req, res) => {
  if (!mysql) return res.json({ ok: false, message: 'mysql2 tidak terinstall. Jalankan: npm install mysql2' });

  const { host, port, user, password, database } = req.body;
  if (!host || !user || !database) {
    return res.json({ ok: false, message: 'Host, user, dan database wajib diisi' });
  }
  try {
    const conn = await mysql.createConnection({
      host, port: Number(port) || 3306,
      user, password: password || '', database,
      connectTimeout: 5000,
    });
    await conn.query('SELECT 1');
    await conn.end();
    res.json({ ok: true, message: 'Koneksi berhasil!' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// POST /api/settings/db — save config & reconnect
router.post('/db', async (req, res) => {
  const { host, port, user, password, database, keepPassword } = req.body;
  if (!host || !user || !database) {
    return res.status(400).json({ error: 'Host, user, dan database wajib diisi' });
  }

  const finalPassword = keepPassword
    ? (db.loadConfig().password || '')
    : (password || '');

  const cfg = {
    host:     host.trim(),
    port:     Number(port) || 3306,
    user:     user.trim(),
    password: finalPassword,
    database: database.trim(),
  };

  db.saveConfig(cfg);
  const ok = await db.connect(cfg);

  if (ok) {
    if (req.session?.role) {
      logEvent(req, 'UPDATE_DB_CONFIG',
        `Konfigurasi MySQL diperbarui: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
    }
    res.json({ ok: true, message: 'Database berhasil terhubung dan schema diinisialisasi.' });
  } else {
    res.status(500).json({
      ok: false,
      error: 'Konfigurasi disimpan tapi gagal terhubung. Periksa parameter koneksi.',
    });
  }
});

module.exports = router;
