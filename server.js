const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: 'duitkau-secret-key-ganti-di-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000, // 8 jam
    },
  })
);

// ─── Redirect /page.html → /page ─────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5);
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, clean + qs);
  }
  next();
});

// Disable caching for HTML files so browsers always get latest version
app.use((req, res, next) => {
  if (!req.path.includes('.') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ─── Health check (tidak diblokir oleh DB guard) ─────────────
app.get('/api/health', async (req, res) => {
  if (!db.isConnected()) return res.status(503).json({ db: false });
  try {
    await db.allAsync('SELECT 1');
    res.json({ db: true });
  } catch {
    res.status(503).json({ db: false });
  }
});

// ─── Settings (bypass DB guard — dibutuhkan saat DB belum dikonfigurasi) ─
app.use('/api/settings', require('./routes/settings'));

// ─── DB Guard — blokir semua API lain jika DB tidak terhubung ─
app.use('/api', (req, res, next) => {
  if (!db.isConnected()) {
    return res.status(503).json({ error: 'Database tidak terhubung. Konfigurasi di /settings' });
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/share', require('./routes/share'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/ca', require('./routes/ca'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/karyawan', require('./routes/karyawan'));
app.use('/api/inventory', require('./routes/inventory'));

app.get('/', (req, res) => {
  res.redirect('/login');
});

const server = app.listen(PORT, () => {
  console.log(`DuitKau berjalan di http://localhost:${PORT}`);
  console.log('Akun default:');
  console.log('  Super Admin: admin / admin123');
  console.log('  Finance    : finance / finance123');
  console.log('  Karyawan   : alice / alice123');
  console.log('  Karyawan   : bob / bob123');
  console.log('  Karyawan   : charlie / charlie123');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah digunakan. Jalankan: fuser -k ${PORT}/tcp`);
    process.exit(1);
  } else {
    throw err;
  }
});
