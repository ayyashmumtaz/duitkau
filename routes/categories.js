const express = require('express');
const db = require('../database');
const { requireLogin, requireFinance } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT c.*, COUNT(t.id) as tx_count
       FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
       GROUP BY c.id ORDER BY c.name`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Gagal mengambil data kategori' }); }
});

router.post('/', requireLogin, requireFinance, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
  try {
    const result = await db.runAsync('INSERT INTO categories (name) VALUES (?)', [name.trim()]);
    const cat = await db.getAsync('SELECT * FROM categories WHERE id = ?', [result.lastID]);
    res.status(201).json(cat);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama kategori sudah ada' });
    res.status(500).json({ error: 'Gagal membuat kategori' });
  }
});

router.put('/:id', requireLogin, requireFinance, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
  try {
    await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    const cat = await db.getAsync('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!cat) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    res.json(cat);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama kategori sudah ada' });
    res.status(500).json({ error: 'Gagal mengupdate kategori' });
  }
});

router.delete('/:id', requireLogin, requireFinance, async (req, res) => {
  try {
    const usage = await db.getAsync('SELECT COUNT(*) as count FROM transactions WHERE category_id = ?', [req.params.id]);
    if (usage.count > 0)
      return res.status(400).json({ error: `Tidak bisa dihapus — masih digunakan oleh ${usage.count} transaksi` });
    await db.runAsync('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Gagal menghapus kategori' }); }
});

module.exports = router;
