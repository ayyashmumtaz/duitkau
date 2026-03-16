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

app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check (tidak diblokir oleh DB guard) ─────────────
app.get('/api/health', (req, res) => {
  const connected = db.isConnected();
  res.status(connected ? 200 : 503).json({ db: connected });
});

// ─── DB Guard — blokir semua API lain jika DB tidak terhubung ─
app.use('/api', (req, res, next) => {
  if (!db.isConnected()) {
    return res.status(503).json({ error: 'Database tidak terhubung. Coba beberapa saat lagi.' });
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

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const server = app.listen(PORT, () => {
  console.log(`DuitKau berjalan di http://localhost:${PORT}`);
  console.log('Akun default:');
  console.log('  Finance : finance / finance123');
  console.log('  Karyawan: alice / alice123');
  console.log('  Karyawan: bob / bob123');
  console.log('  Karyawan: charlie / charlie123');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah digunakan. Jalankan: fuser -k ${PORT}/tcp`);
    process.exit(1);
  } else {
    throw err;
  }
});
