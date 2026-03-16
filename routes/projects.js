const express = require('express');
const db = require('../database');
const { requireLogin, requireFinance } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');
const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT p.*, COUNT(t.id) as tx_count
       FROM projects p LEFT JOIN transactions t ON t.project_id = p.id
       GROUP BY p.id ORDER BY p.name`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Gagal mengambil data proyek' }); }
});

router.post('/', requireLogin, requireFinance, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama proyek wajib diisi' });
  try {
    const result = await db.runAsync('INSERT INTO projects (name, description) VALUES (?, ?)', [name.trim(), description || null]);
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [result.lastID]);
    
    logEvent(req, 'CREATE_PROJECT', `Membuat proyek "${project.name}"`);
    
    res.status(201).json(project);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama proyek sudah ada' });
    res.status(500).json({ error: 'Gagal membuat proyek' });
  }
});

router.put('/:id', requireLogin, requireFinance, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama proyek wajib diisi' });
  try {
    await db.runAsync('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name.trim(), description || null, req.params.id]);
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
    
    logEvent(req, 'UPDATE_PROJECT', `Memperbarui proyek (ID: ${req.params.id}) menjadi "${project.name}"`);
    
    res.json(project);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama proyek sudah ada' });
    res.status(500).json({ error: 'Gagal mengupdate proyek' });
  }
});

router.delete('/:id', requireLogin, requireFinance, async (req, res) => {
  try {
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    await db.runAsync('UPDATE transactions SET project_id = NULL WHERE project_id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM projects WHERE id = ?', [req.params.id]);
    
    logEvent(req, 'DELETE_PROJECT', `Menghapus proyek "${project ? project.name : 'Unknown'}" (ID: ${req.params.id})`);
    
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Gagal menghapus proyek' }); }
});

module.exports = router;
