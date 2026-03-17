const express = require('express');
const db = require('../database');
const { requireLogin, requireSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.use(requireLogin, requireSuperAdmin);

// DELETE all transactions
router.delete('/transactions', async (req, res) => {
  try {
    const result = await db.runAsync('DELETE FROM transactions');
    logEvent(req, 'DELETE_ALL_TRANSACTIONS', `Menghapus semua transaksi (${result.changes} baris)`);
    res.json({ deleted: result.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus transaksi' });
  }
});

// DELETE all cash advances (and their linked transactions)
router.delete('/ca', async (req, res) => {
  try {
    await db.runAsync("DELETE FROM transactions WHERE ca_id IS NOT NULL");
    const result = await db.runAsync('DELETE FROM cash_advances');
    logEvent(req, 'DELETE_ALL_CA', `Menghapus semua cash advance (${result.changes} baris)`);
    res.json({ deleted: result.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus cash advance' });
  }
});

module.exports = router;
