const express = require('express');
const { requireLogin, requireFinanceOrSuperAdmin } = require('../middleware/auth');
const { getLogContent, getLogPath } = require('../utils/logger');
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

module.exports = router;
