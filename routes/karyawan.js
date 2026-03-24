'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireLogin, requireSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');
const router = express.Router();

// GET all karyawan
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.allAsync(`
      SELECT k.*, u.username
      FROM karyawan k
      LEFT JOIN users u ON k.user_id = u.id
      ORDER BY k.status ASC, k.nama ASC
    `);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Gagal mengambil data karyawan' }); }
});

// GET single
router.get('/:id', requireLogin, async (req, res) => {
  try {
    const row = await db.getAsync(`
      SELECT k.*, u.username
      FROM karyawan k
      LEFT JOIN users u ON k.user_id = u.id
      WHERE k.id = ?
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Gagal mengambil data' }); }
});

// POST create — auto-create employee user account
router.post('/', requireLogin, requireSuperAdmin, async (req, res) => {
  const { nama, jabatan, departemen, no_ktp, no_hp, alamat, tanggal_masuk, status, username, password } = req.body;
  if (!nama?.trim())     return res.status(400).json({ error: 'Nama wajib diisi' });
  if (!username?.trim()) return res.status(400).json({ error: 'Username wajib diisi' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

  try {
    const existing = await db.getAsync('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) return res.status(409).json({ error: 'Username sudah digunakan' });

    // Create employee user account
    const hashed = bcrypt.hashSync(password, 10);
    const userResult = await db.runAsync(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      [username.trim(), hashed, nama.trim(), 'employee']
    );
    const userId = userResult.lastID;

    // Create karyawan record linked to that user
    const result = await db.runAsync(
      `INSERT INTO karyawan (nama, jabatan, departemen, no_ktp, no_hp, alamat, tanggal_masuk, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nama.trim(), jabatan || null, departemen || null, no_ktp || null,
       no_hp || null, alamat || null, tanggal_masuk || null,
       status || 'aktif', userId]
    );

    const row = await db.getAsync(
      'SELECT k.*, u.username FROM karyawan k LEFT JOIN users u ON k.user_id = u.id WHERE k.id = ?',
      [result.lastID]
    );
    logEvent(req, 'CREATE_KARYAWAN', `Menambah karyawan "${row.nama}" (@${username.trim()})`);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah karyawan' });
  }
});

// PUT update
router.put('/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  const { nama, jabatan, departemen, no_ktp, no_hp, alamat, tanggal_masuk, status, username, password } = req.body;
  if (!nama?.trim()) return res.status(400).json({ error: 'Nama wajib diisi' });

  try {
    const kar = await db.getAsync('SELECT * FROM karyawan WHERE id = ?', [req.params.id]);
    if (!kar) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

    // Update linked user account
    if (kar.user_id) {
      if (username?.trim()) {
        const conflict = await db.getAsync('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), kar.user_id]);
        if (conflict) return res.status(409).json({ error: 'Username sudah digunakan' });
      }
      const userFields = ['full_name = ?'];
      const userValues = [nama.trim()];
      if (username?.trim()) { userFields.push('username = ?'); userValues.push(username.trim()); }
      if (password && password.length >= 6) { userFields.push('password = ?'); userValues.push(bcrypt.hashSync(password, 10)); }
      else if (password && password.length > 0) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      userValues.push(kar.user_id);
      await db.runAsync(`UPDATE users SET ${userFields.join(', ')} WHERE id = ?`, userValues);
    }

    // Update karyawan record
    await db.runAsync(
      `UPDATE karyawan SET nama=?, jabatan=?, departemen=?, no_ktp=?, no_hp=?,
       alamat=?, tanggal_masuk=?, status=? WHERE id=?`,
      [nama.trim(), jabatan || null, departemen || null, no_ktp || null,
       no_hp || null, alamat || null, tanggal_masuk || null,
       status || 'aktif', req.params.id]
    );

    const row = await db.getAsync(
      'SELECT k.*, u.username FROM karyawan k LEFT JOIN users u ON k.user_id = u.id WHERE k.id = ?',
      [req.params.id]
    );
    logEvent(req, 'UPDATE_KARYAWAN', `Memperbarui karyawan "${row.nama}" (ID: ${row.id})`);
    res.json(row);
  } catch { res.status(500).json({ error: 'Gagal memperbarui karyawan' }); }
});

// DELETE — also deletes linked employee user account
router.delete('/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  try {
    const kar = await db.getAsync('SELECT * FROM karyawan WHERE id = ?', [req.params.id]);
    if (!kar) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

    // Delete linked user (employee role only — safety guard)
    if (kar.user_id) {
      const user = await db.getAsync('SELECT role FROM users WHERE id = ?', [kar.user_id]);
      if (user && user.role === 'employee') {
        await db.runAsync('DELETE FROM transactions WHERE user_id = ?', [kar.user_id]);
        await db.runAsync('DELETE FROM users WHERE id = ?', [kar.user_id]);
      }
    }

    await db.runAsync('DELETE FROM karyawan WHERE id = ?', [req.params.id]);
    logEvent(req, 'DELETE_KARYAWAN', `Menghapus karyawan "${kar.nama}" (ID: ${kar.id})`);
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Gagal menghapus karyawan' }); }
});

module.exports = router;
