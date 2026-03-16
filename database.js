const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'duitkau.db');

let dbConnected = false;

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Gagal membuka database:', err.message);
    dbConnected = false;
  } else {
    dbConnected = true;
  }
});

db.on('error', (err) => {
  console.error('Database error:', err.message);
  dbConnected = false;
});

// Enable WAL and foreign keys
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('employee', 'finance')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('masuk', 'keluar')),
      name TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      date TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS share_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      params TEXT NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migration: tambah kolom baru jika belum ada
  db.all("PRAGMA table_info(transactions)", (err, cols) => {
    if (err) return;
    const names = cols.map(c => c.name);
    if (!names.includes('status'))
      db.run("ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
    if (!names.includes('proof_image'))
      db.run("ALTER TABLE transactions ADD COLUMN proof_image TEXT");
    if (!names.includes('input_by'))
      db.run("ALTER TABLE transactions ADD COLUMN input_by INTEGER");
    if (!names.includes('review_note'))
      db.run("ALTER TABLE transactions ADD COLUMN review_note TEXT");
    if (!names.includes('project_id'))
      db.run("ALTER TABLE transactions ADD COLUMN project_id INTEGER REFERENCES projects(id)");
    if (!names.includes('category_id'))
      db.run("ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories(id)");
  });

  // Seed default users if empty
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err || row.count > 0) return;

    const hash = (p) => bcrypt.hashSync(p, 10);
    const stmt = db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)');
    stmt.run('finance', hash('finance123'), 'Tim Finance', 'finance');
    stmt.run('alice', hash('alice123'), 'Alice Putri', 'employee');
    stmt.run('bob', hash('bob123'), 'Bob Santoso', 'employee');
    stmt.run('charlie', hash('charlie123'), 'Charlie Wijaya', 'employee');
    stmt.finalize();
    console.log('Database seeded with default users.');
  });

  // Seed default categories if empty
  db.get('SELECT COUNT(*) as count FROM categories', (err, row) => {
    if (err || row.count > 0) return;
    ['Transport', 'Makan', 'Beli Barang', 'Jasa', 'Lainnya'].forEach(name => {
      db.run('INSERT INTO categories (name) VALUES (?)', [name]);
    });
  });
});

// Promisified helpers
db.getAsync = (sql, params = []) =>
  new Promise((res, rej) =>
    db.get(sql, params, (err, row) => (err ? rej(err) : res(row)))
  );

db.allAsync = (sql, params = []) =>
  new Promise((res, rej) =>
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)))
  );

db.runAsync = (sql, params = []) =>
  new Promise((res, rej) =>
    db.run(sql, params, function (err) {
      if (err) return rej(err);
      res({ lastID: this.lastID, changes: this.changes });
    })
  );

db.isConnected = () => dbConnected;

module.exports = db;
