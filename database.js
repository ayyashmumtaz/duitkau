'use strict';

const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

// mysql2 is optional until installed
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  console.error('[DB] mysql2 tidak terinstall. Jalankan: npm install mysql2 && npm uninstall sqlite3');
}

const CONFIG_PATH = path.join(__dirname, 'config.json');

let pool        = null;
let dbConnected = false;

// ── Config file helpers ───────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).db || {};
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  current.db = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf8');
}

// ── MySQL schema (CREATE TABLE IF NOT EXISTS) ─────────────────────
const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id        INT          NOT NULL AUTO_INCREMENT,
    username  VARCHAR(100) NOT NULL,
    password  VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role      ENUM('employee','finance','super_admin') NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS projects (
    id          INT          NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255) NOT NULL,
    po_number   VARCHAR(100) NOT NULL DEFAULT '',
    description TEXT,
    created_at  DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS categories (
    id         INT          NOT NULL AUTO_INCREMENT,
    name       VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS cash_advances (
    id                        INT     NOT NULL AUTO_INCREMENT,
    title                     VARCHAR(255) NOT NULL,
    description               TEXT,
    initial_amount            DOUBLE  NOT NULL,
    project_id                INT,
    request_by                INT     NOT NULL,
    request_at                DATETIME DEFAULT NOW(),
    open_by                   INT,
    open_at                   DATETIME,
    close_requested_by        INT,
    close_requested_at        DATETIME,
    close_request_note        TEXT,
    closed_by                 INT,
    closed_at                 DATETIME,
    status                    ENUM('pending','open','pending_close','closed','rejected') NOT NULL DEFAULT 'pending',
    reimbursement_requested   TINYINT NOT NULL DEFAULT 0,
    created_at                DATETIME DEFAULT NOW(),
    close_reject_reason       TEXT,
    reimbursement_status      VARCHAR(50),
    reimbursement_reject_reason TEXT,
    reimbursement_amount      DOUBLE,
    reimbursement_proof       TEXT,
    reimbursement_at          DATETIME,
    reimbursement_by          INT,
    allowance                 DOUBLE NOT NULL DEFAULT 0,
    transport                 DOUBLE NOT NULL DEFAULT 0,
    accommodation             DOUBLE NOT NULL DEFAULT 0,
    other_expenses            DOUBLE NOT NULL DEFAULT 0,
    start_date                DATE,
    end_date                  DATE,
    refund_status             VARCHAR(50),
    refund_amount             DOUBLE,
    refund_proof              TEXT,
    refund_note               TEXT,
    refund_requested_at       DATETIME,
    refund_requested_by       INT,
    refund_confirmed_at       DATETIME,
    refund_confirmed_by       INT,
    refund_reject_reason      TEXT,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id           INT    NOT NULL AUTO_INCREMENT,
    user_id      INT    NOT NULL,
    type         ENUM('masuk','keluar') NOT NULL,
    name         TEXT   NOT NULL,
    amount       DOUBLE NOT NULL,
    date         DATE   NOT NULL,
    note         TEXT,
    created_at   DATETIME DEFAULT NOW(),
    status       VARCHAR(50) NOT NULL DEFAULT 'approved',
    proof_image  TEXT,
    input_by     INT,
    review_note  TEXT,
    project_id   INT,
    category_id  INT,
    ca_id        INT,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS project_approvers (
    id         INT NOT NULL AUTO_INCREMENT,
    project_id INT NOT NULL,
    user_id    INT NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_project_user (project_id, user_id),
    KEY idx_project_id (project_id),
    KEY idx_user_id    (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ca_approvals (
    id           INT  NOT NULL AUTO_INCREMENT,
    ca_id        INT  NOT NULL,
    type         ENUM('open','reimburse') NOT NULL,
    approver_id  INT  NOT NULL,
    status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    decided_at   DATETIME,
    reject_reason TEXT,
    created_at   DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_type_approver (ca_id, type, approver_id),
    KEY idx_ca_id           (ca_id),
    KEY idx_approver_status (approver_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS share_tokens (
    id         INT          NOT NULL AUTO_INCREMENT,
    token      VARCHAR(255) NOT NULL,
    params     TEXT         NOT NULL,
    label      VARCHAR(255),
    created_at DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_token (token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS event_logs (
    id        INT          NOT NULL AUTO_INCREMENT,
    timestamp DATETIME     DEFAULT NOW(),
    username  VARCHAR(100) NOT NULL,
    role      VARCHAR(50)  NOT NULL,
    ip        VARCHAR(50)  NOT NULL,
    action    VARCHAR(100) NOT NULL,
    details   TEXT         NOT NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function initSchema(p) {
  for (const sql of TABLES) {
    await p.query(sql);
  }

  // Ensure super_admin exists
  const [[sa]] = await p.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1");
  if (!sa) {
    const hashed = bcrypt.hashSync('admin123', 10);
    await p.query(
      "INSERT INTO users (username, password, full_name, role) VALUES ('admin', ?, 'Super Admin', 'super_admin')",
      [hashed]
    );
    console.log('[DB] super_admin dibuat: admin / admin123');
  }

  // Seed default users if only super_admin exists
  const [[{ c }]] = await p.query('SELECT COUNT(*) AS c FROM users');
  if (c <= 1) {
    const h = (pw) => bcrypt.hashSync(pw, 10);
    const users = [
      ['finance', h('finance123'), 'Tim Finance',     'finance'],
      ['alice',   h('alice123'),   'Alice Putri',     'employee'],
      ['bob',     h('bob123'),     'Bob Santoso',     'employee'],
      ['charlie', h('charlie123'), 'Charlie Wijaya',  'employee'],
    ];
    for (const [u, pw, fn, role] of users) {
      await p.query(
        'INSERT IGNORE INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
        [u, pw, fn, role]
      );
    }
    console.log('[DB] Default users seeded');
  }

  // Seed categories
  const [[{ cc }]] = await p.query('SELECT COUNT(*) AS cc FROM categories');
  if (cc === 0) {
    for (const name of ['Transport', 'Makan', 'Beli Barang', 'Jasa', 'Lainnya']) {
      await p.query('INSERT IGNORE INTO categories (name) VALUES (?)', [name]);
    }
  }
}

// ── Connect / reconnect ───────────────────────────────────────────
async function connect(cfg) {
  if (pool) {
    try { await pool.end(); } catch {}
    pool        = null;
    dbConnected = false;
  }

  if (!mysql) {
    console.error('[DB] mysql2 tidak terinstall.');
    return false;
  }

  if (!cfg || !cfg.host || !cfg.user || !cfg.database) {
    console.warn('[DB] Belum dikonfigurasi. Buka /settings.html');
    return false;
  }

  try {
    const newPool = mysql.createPool({
      host:             cfg.host,
      port:             Number(cfg.port) || 3306,
      user:             cfg.user,
      password:         cfg.password || '',
      database:         cfg.database,
      waitForConnections: true,
      connectionLimit:  10,
      timezone:         '+07:00',
      dateStrings:      true,   // DATE/DATETIME returned as strings (YYYY-MM-DD / YYYY-MM-DD HH:MM:SS)
    });

    await newPool.query('SELECT 1');
    pool        = newPool;
    dbConnected = true;
    console.log(`[DB] MySQL terhubung: ${cfg.user}@${cfg.host}:${cfg.port || 3306}/${cfg.database}`);

    await initSchema(pool);
    return true;
  } catch (err) {
    console.error('[DB] Gagal terhubung:', err.message);
    pool        = null;
    dbConnected = false;
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────
const db = {
  isConnected: () => dbConnected,
  connect,
  loadConfig,
  saveConfig,

  getAsync: (sql, params = []) => {
    if (!pool) return Promise.reject(new Error('Database tidak terhubung'));
    return pool.execute(sql, params).then(([rows]) => rows[0] ?? null);
  },

  allAsync: (sql, params = []) => {
    if (!pool) return Promise.reject(new Error('Database tidak terhubung'));
    return pool.execute(sql, params).then(([rows]) => rows);
  },

  runAsync: (sql, params = []) => {
    if (!pool) return Promise.reject(new Error('Database tidak terhubung'));
    return pool.execute(sql, params).then(([result]) => ({
      lastID:  result.insertId,
      changes: result.affectedRows,
    }));
  },

  // Wraps a function in a MySQL transaction
  transaction: async (fn) => {
    if (!pool) throw new Error('Database tidak terhubung');
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const tx = {
      getAsync: (sql, p = []) => conn.execute(sql, p).then(([rows])   => rows[0] ?? null),
      allAsync: (sql, p = []) => conn.execute(sql, p).then(([rows])   => rows),
      runAsync: (sql, p = []) => conn.execute(sql, p).then(([result]) => ({
        lastID:  result.insertId,
        changes: result.affectedRows,
      })),
    };
    try {
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

// Connect on startup
connect(loadConfig()).catch(() => {});

module.exports = db;
