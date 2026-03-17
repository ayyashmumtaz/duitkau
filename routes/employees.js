const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireLogin, requireFinanceOrSuperAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.use(requireLogin, requireFinanceOrSuperAdmin);

// GET all users (employee + finance + super_admin)
router.get('/', async (req, res) => {
  try {
    const users = await db.allAsync(
      "SELECT id, username, full_name, role, created_at FROM users ORDER BY role, full_name"
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data pengguna' });
  }
});

// GET single user
router.get('/:id', async (req, res) => {
  try {
    const user = await db.getAsync(
      'SELECT id, username, full_name, role, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data pengguna' });
  }
});

// POST create user
router.post('/', requireSuperAdmin, async (req, res) => {
  const { username, full_name, password, role } = req.body;

  const allowedRoles = ['employee', 'finance', 'super_admin'];
  const userRole = allowedRoles.includes(role) ? role : 'employee';

  if (!username?.trim()) return res.status(400).json({ error: 'Username wajib diisi' });
  if (!full_name?.trim()) return res.status(400).json({ error: 'Nama lengkap wajib diisi' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });

  // Only super_admin can create super_admin accounts
  if (userRole === 'super_admin' && req.session.role !== 'super_admin') {
    return res.status(403).json({ error: 'Hanya super admin yang bisa membuat akun super admin' });
  }

  try {
    const existing = await db.getAsync('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) return res.status(409).json({ error: 'Username sudah digunakan' });

    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.runAsync(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      [username.trim(), hashed, full_name.trim(), userRole]
    );
    const inserted = await db.getAsync(
      'SELECT id, username, full_name, role, created_at FROM users WHERE id = ?',
      [result.lastID]
    );

    logEvent(req, 'CREATE_USER', `Membuat akun ${userRole}: ${full_name.trim()} (${username.trim()})`);

    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat pengguna' });
  }
});

// PUT update user
router.put('/:id', requireSuperAdmin, async (req, res) => {
  const { username, full_name, password, role } = req.body;

  if (!username?.trim()) return res.status(400).json({ error: 'Username wajib diisi' });
  if (!full_name?.trim()) return res.status(400).json({ error: 'Nama lengkap wajib diisi' });

  try {
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    const conflict = await db.getAsync(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username.trim(), req.params.id]
    );
    if (conflict) return res.status(409).json({ error: 'Username sudah digunakan' });

    // Determine new role
    let newRole = user.role;
    if (role && req.session.role === 'super_admin') {
      const allowedRoles = ['employee', 'finance', 'super_admin'];
      if (allowedRoles.includes(role)) newRole = role;
    }

    // Cannot demote yourself from super_admin
    if (parseInt(req.params.id) === req.session.userId && newRole !== 'super_admin') {
      return res.status(400).json({ error: 'Tidak bisa mengubah role akun sendiri' });
    }

    const fields = ['username = ?', 'full_name = ?', 'role = ?'];
    const values = [username.trim(), full_name.trim(), newRole];

    if (password && password.length > 0) {
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      fields.push('password = ?');
      values.push(bcrypt.hashSync(password, 10));
    }
    values.push(req.params.id);

    await db.runAsync(
      `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    const updated = await db.getAsync(
      'SELECT id, username, full_name, role, created_at FROM users WHERE id = ?',
      [req.params.id]
    );

    logEvent(req, 'UPDATE_USER', `Memperbarui profil akun: ${updated.full_name} (${updated.username})`);

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengupdate pengguna' });
  }
});

// DELETE user (cannot delete self)
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.session.userId)
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });

  try {
    const user = await db.getAsync('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    await db.runAsync('DELETE FROM transactions WHERE user_id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM users WHERE id = ?', [req.params.id]);

    logEvent(req, 'DELETE_USER', `Menghapus akun ${user.role}: ${user.full_name} (${user.username})`);

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus pengguna' });
  }
});

module.exports = router;
