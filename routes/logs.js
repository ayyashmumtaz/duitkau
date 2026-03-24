const express = require('express');
const { requireLogin, requireFinanceOrSuperAdmin } = require('../middleware/auth');
const { getLogContent, getLogPath, listLogFiles } = require('../utils/logger');
const db = require('../database');
const fs = require('fs');

const router = express.Router();

router.use(requireLogin, requireFinanceOrSuperAdmin);

// Mengambil isi text log
router.get('/', (req, res) => {
  try {
    const logs = getLogContent();
    res.type('text/plain');
    res.send(logs);
  } catch (err) {
    res.status(500).send('Gagal mengambil event log.');
  }
});

// Download log file
router.get('/download', (req, res) => {
  try {
    const filePath = getLogPath();
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File log belum ada' });
    }
    res.download(filePath, 'event-log.txt');
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengunduh log' });
  }
});

// Paginated DB logs dengan filter
router.get('/db', async (req, res) => {
  const { page = 1, limit = 100, q, action_prefix } = req.query;
  const offset  = (parseInt(page) - 1) * parseInt(limit);
  try {
    const where  = ['1=1'];
    const params = [];
    if (q)             { where.push('(action LIKE ? OR details LIKE ? OR username LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (action_prefix) { where.push('action LIKE ?'); params.push(`${action_prefix}%`); }

    const wClause = where.join(' AND ');
    const [countRow, rows] = await Promise.all([
      db.getAsync(`SELECT COUNT(*) as n FROM event_logs WHERE ${wClause}`, params),
      db.allAsync(
        `SELECT * FROM event_logs WHERE ${wClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      ),
    ]);
    res.json({ total: countRow.n, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List semua file log (aktif + arsip)
router.get('/files', (req, res) => {
  res.json(listLogFiles());
});

module.exports = router;
