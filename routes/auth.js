const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const user = await db.getAsync('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.fullName = user.full_name;
    req.session.role = user.role;

    logEvent(req, 'LOGIN', `Pengguna ${user.role} berhasil login`);

    res.json({ role: user.role, fullName: user.full_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req, res) => {
  logEvent(req, 'LOGOUT', 'Pengguna melakukan logout');
  req.session.destroy(() => {
    res.json({ message: 'Logout berhasil' });
  });
});

// Change own password (any logged-in user)
router.put('/password', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  try {
    const hashed = bcrypt.hashSync(password, 10);
    await db.runAsync('UPDATE users SET password = ? WHERE id = ?', [hashed, req.session.userId]);
    
    logEvent(req, 'UPDATE_PASSWORD', 'Pengguna mengganti password');
    
    res.json({ message: 'Password berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah password' });
  }
});

// Edit own profile (any logged-in user)
router.put('/profile', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { full_name, username, password } = req.body;
  if (!full_name?.trim()) return res.status(400).json({ error: 'Nama lengkap wajib diisi' });
  if (!username?.trim()) return res.status(400).json({ error: 'Username wajib diisi' });

  try {
    // Check username not taken by someone else
    const existing = await db.getAsync('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), req.session.userId]);
    if (existing) return res.status(400).json({ error: 'Username sudah digunakan' });

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      const hashed = bcrypt.hashSync(password, 10);
      await db.runAsync('UPDATE users SET full_name = ?, username = ?, password = ? WHERE id = ?',
        [full_name.trim(), username.trim(), hashed, req.session.userId]);
    } else {
      await db.runAsync('UPDATE users SET full_name = ?, username = ? WHERE id = ?',
        [full_name.trim(), username.trim(), req.session.userId]);
    }

    // Update session
    req.session.fullName = full_name.trim();
    req.session.username = username.trim();
    res.json({ fullName: full_name.trim(), username: username.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui profil' });
  }
});

router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    userId: req.session.userId,
    username: req.session.username,
    fullName: req.session.fullName,
    role: req.session.role,
  });
});

module.exports = router;
