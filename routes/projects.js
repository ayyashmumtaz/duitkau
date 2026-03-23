const express = require('express');
const db = require('../database');
const { requireLogin, requireSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');
const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT p.*,
        COUNT(DISTINCT t.id)  as tx_count,
        COUNT(DISTINCT pa.id) as approver_count
       FROM projects p
       LEFT JOIN transactions      t  ON t.project_id  = p.id
       LEFT JOIN project_approvers pa ON pa.project_id = p.id
       GROUP BY p.id ORDER BY p.name`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Gagal mengambil data proyek' }); }
});

router.post('/', requireLogin, requireSuperAdmin, async (req, res) => {
  const { name, po_number, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama proyek wajib diisi' });
  if (!po_number?.trim()) return res.status(400).json({ error: 'Nomor SO wajib diisi' });
  try {
    const result = await db.runAsync('INSERT INTO projects (name, po_number, description) VALUES (?, ?, ?)', [name.trim(), po_number.trim(), description || null]);
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [result.lastID]);
    logEvent(req, 'CREATE_PROJECT', `Membuat proyek "${project.name}" (SO: ${project.po_number})`);
    res.status(201).json(project);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama proyek sudah ada' });
    res.status(500).json({ error: 'Gagal membuat proyek' });
  }
});

router.put('/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  const { name, po_number, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama proyek wajib diisi' });
  if (!po_number?.trim()) return res.status(400).json({ error: 'Nomor SO wajib diisi' });
  try {
    await db.runAsync('UPDATE projects SET name = ?, po_number = ?, description = ? WHERE id = ?', [name.trim(), po_number.trim(), description || null, req.params.id]);
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
    logEvent(req, 'UPDATE_PROJECT', `Memperbarui proyek (ID: ${req.params.id}) menjadi "${project.name}" (SO: ${project.po_number})`);
    res.json(project);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nama proyek sudah ada' });
    res.status(500).json({ error: 'Gagal mengupdate proyek' });
  }
});

router.delete('/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  try {
    const project = await db.getAsync('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM project_approvers WHERE project_id = ?', [req.params.id]);
    await db.runAsync('UPDATE transactions SET project_id = NULL WHERE project_id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM projects WHERE id = ?', [req.params.id]);
    logEvent(req, 'DELETE_PROJECT', `Menghapus proyek "${project ? project.name : 'Unknown'}" (ID: ${req.params.id})`);
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Gagal menghapus proyek' }); }
});

// ─── Approver sub-resource ────────────────────────────────────
router.get('/:id/approvers', requireLogin, async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT pa.id, pa.user_id, u.full_name, u.username, u.role
       FROM project_approvers pa
       JOIN users u ON pa.user_id = u.id
       WHERE pa.project_id = ?
       ORDER BY u.full_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Gagal mengambil approver proyek' }); }
});

router.post('/:id/approvers', requireLogin, requireSuperAdmin, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id wajib diisi' });
  try {
    await db.runAsync(
      `INSERT INTO project_approvers (project_id, user_id) VALUES (?, ?)`,
      [req.params.id, user_id]
    );
    const approver = await db.getAsync(
      `SELECT pa.id, pa.user_id, u.full_name, u.username, u.role
       FROM project_approvers pa JOIN users u ON pa.user_id=u.id
       WHERE pa.project_id=? AND pa.user_id=?`,
      [req.params.id, user_id]
    );
    logEvent(req, 'ADD_PROJECT_APPROVER', `Menambah approver "${approver.full_name}" ke proyek ID ${req.params.id}`);
    res.status(201).json(approver);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'User sudah menjadi approver proyek ini' });
    res.status(500).json({ error: 'Gagal menambah approver' });
  }
});

router.delete('/:id/approvers/:userId', requireLogin, requireSuperAdmin, async (req, res) => {
  try {
    await db.runAsync(
      `DELETE FROM project_approvers WHERE project_id=? AND user_id=?`,
      [req.params.id, req.params.userId]
    );
    logEvent(req, 'REMOVE_PROJECT_APPROVER', `Menghapus approver (user_id=${req.params.userId}) dari proyek ID ${req.params.id}`);
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Gagal menghapus approver' }); }
});

module.exports = router;
