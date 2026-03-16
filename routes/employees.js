const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireLogin, requireFinance } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.use(requireLogin, requireFinance);

// GET all users (employee + finance)
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

// POST create user (employee or finance)
router.post('/', async (req, res) => {
  const { username, full_name, password, role } = req.body;
  const userRole = role === 'finance' ? 'finance' : 'employee';

  if (!username?.trim()) return res.status(400).json({ error: 'Username wajib diisi' });
  if (!full_name?.trim()) return res.status(400).json({ error: 'Nama lengkap wajib diisi' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });

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
router.put('/:id', async (req, res) => {
  const { username, full_name, password } = req.body;

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

    if (password && password.length > 0) {
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      const hashed = bcrypt.hashSync(password, 10);
      await db.runAsync(
        'UPDATE users SET username = ?, full_name = ?, password = ? WHERE id = ?',
        [username.trim(), full_name.trim(), hashed, req.params.id]
      );
    } else {
      await db.runAsync(
        'UPDATE users SET username = ?, full_name = ? WHERE id = ?',
        [username.trim(), full_name.trim(), req.params.id]
      );
    }

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
router.delete('/:id', async (req, res) => {
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
