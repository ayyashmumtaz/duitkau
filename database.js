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

  `CREATE TABLE IF NOT EXISTS reimburse_batches (
    id           INT      NOT NULL AUTO_INCREMENT,
    user_id      INT      NOT NULL,
    submitted_at DATETIME DEFAULT NOW(),
    status       ENUM('pending','approved') NOT NULL DEFAULT 'pending',
    approved_by  INT,
    approved_at  DATETIME,
    PRIMARY KEY (id),
    KEY idx_status  (status),
    KEY idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS karyawan (
    id            INT          NOT NULL AUTO_INCREMENT,
    nama          VARCHAR(255) NOT NULL,
    jabatan       VARCHAR(255),
    departemen    VARCHAR(255),
    no_ktp        VARCHAR(50),
    no_hp         VARCHAR(50),
    alamat        TEXT,
    tanggal_masuk DATE,
    status        ENUM('aktif','nonaktif') NOT NULL DEFAULT 'aktif',
    user_id       INT,
    created_at    DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    KEY idx_status (status),
    KEY idx_user_id (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── Inventory Workshop ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS inv_locations (
    id         INT          NOT NULL AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    type       ENUM('warehouse','vehicle','workbench','area') NOT NULL DEFAULT 'warehouse',
    qr_code    VARCHAR(100),
    notes      TEXT,
    created_at DATETIME DEFAULT NOW(),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_racks (
    id          INT         NOT NULL AUTO_INCREMENT,
    location_id INT         NOT NULL,
    name        VARCHAR(50) NOT NULL,
    notes       TEXT,
    created_at  DATETIME    DEFAULT NOW(),
    PRIMARY KEY (id),
    KEY idx_location_id (location_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_items (
    id          INT          NOT NULL AUTO_INCREMENT,
    code        VARCHAR(50)  NOT NULL,
    name        VARCHAR(200) NOT NULL,
    category    ENUM('tools','consumable') NOT NULL,
    unit        VARCHAR(20)  NOT NULL DEFAULT 'pcs',
    min_stock   INT          NOT NULL DEFAULT 0,
    description TEXT,
    created_at  DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_stock (
    id           INT            NOT NULL AUTO_INCREMENT,
    item_id      INT            NOT NULL,
    rack_id      INT            NOT NULL,
    qty          DECIMAL(10,2)  NOT NULL DEFAULT 0,
    qty_borrowed INT            NOT NULL DEFAULT 0,
    qty_damaged  INT            NOT NULL DEFAULT 0,
    qty_lost     INT            NOT NULL DEFAULT 0,
    updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_item_rack (item_id, rack_id),
    KEY idx_item_id (item_id),
    KEY idx_rack_id (rack_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_borrows (
    id               INT          NOT NULL AUTO_INCREMENT,
    item_id          INT          NOT NULL,
    from_rack_id     INT          NOT NULL,
    qty              INT          NOT NULL DEFAULT 1,
    borrower_name    VARCHAR(100) NOT NULL,
    borrower_user_id INT,
    borrowed_at      DATETIME     DEFAULT NOW(),
    expected_return  DATE,
    returned_at      DATETIME,
    return_rack_id   INT,
    notes            TEXT,
    status           ENUM('active','returned') NOT NULL DEFAULT 'active',
    created_by       INT,
    PRIMARY KEY (id),
    KEY idx_item_id (item_id),
    KEY idx_status  (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_transactions (
    id          INT            NOT NULL AUTO_INCREMENT,
    type        ENUM('in','out','borrow','return','transfer','adjustment') NOT NULL,
    item_id     INT            NOT NULL,
    rack_id     INT,
    to_rack_id  INT,
    qty         DECIMAL(10,2)  NOT NULL,
    qty_before  DECIMAL(10,2),
    qty_after   DECIMAL(10,2),
    ref_id      INT,
    notes       TEXT,
    created_by  INT,
    created_at  DATETIME DEFAULT NOW(),
    PRIMARY KEY (id),
    KEY idx_item_id    (item_id),
    KEY idx_type       (type),
    KEY idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── Inventory master data ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS inv_units (
    id   INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(20) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inv_item_categories (
    id   INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    type ENUM('tools','consumable') NOT NULL DEFAULT 'consumable',
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── HRD master data ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS hr_departments (
    id   INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function initSchema(p) {
  for (const sql of TABLES) {
    await p.query(sql);
  }

  // Add batch_id to transactions if missing (migration)
  const [batchIdCols] = await p.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'batch_id'`
  );
  if (!batchIdCols.length) {
    await p.query(`ALTER TABLE transactions ADD COLUMN batch_id INT AFTER ca_id`);
  }

  // Migration: add payment_status, paid_at, paid_by to cash_advances
  const [paymentStatusCol] = await p.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_advances' AND COLUMN_NAME = 'payment_status'`
  );
  if (!paymentStatusCol.length) {
    await p.query(`ALTER TABLE cash_advances ADD COLUMN payment_status ENUM('unpaid','paid') DEFAULT NULL AFTER status`);
    await p.query(`ALTER TABLE cash_advances ADD COLUMN paid_at DATETIME DEFAULT NULL AFTER payment_status`);
    await p.query(`ALTER TABLE cash_advances ADD COLUMN paid_by INT DEFAULT NULL AFTER paid_at`);
    // Backfill: existing open CAs that have no payment_status should be unpaid
    await p.query(`UPDATE cash_advances SET payment_status = 'unpaid' WHERE status = 'open' AND payment_status IS NULL`);
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

  // Seed inv_units
  const [[{ uc }]] = await p.query('SELECT COUNT(*) AS uc FROM inv_units');
  if (uc === 0) {
    for (const name of ['pcs', 'unit', 'm', 'cm', 'kg', 'g', 'L', 'ml', 'set', 'roll', 'lembar', 'box', 'buah']) {
      await p.query('INSERT IGNORE INTO inv_units (name) VALUES (?)', [name]);
    }
  }

  // Seed inv_item_categories
  const [[{ icc }]] = await p.query('SELECT COUNT(*) AS icc FROM inv_item_categories');
  if (icc === 0) {
    await p.query("INSERT IGNORE INTO inv_item_categories (name, type) VALUES ('Tools', 'tools'), ('Consumable', 'consumable')");
  }

  // Seed hr_departments
  const [[{ hdc }]] = await p.query('SELECT COUNT(*) AS hdc FROM hr_departments');
  if (hdc === 0) {
    for (const name of ['Teknik', 'Finance', 'HRD', 'Operasional', 'Marketing', 'IT', 'Produksi']) {
      await p.query('INSERT IGNORE INTO hr_departments (name) VALUES (?)', [name]);
    }
  }

  // Migration: add item_category_id to inv_items
  const [invCatCol] = await p.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_items' AND COLUMN_NAME = 'item_category_id'`
  );
  if (!invCatCol.length) {
    await p.query(`ALTER TABLE inv_items ADD COLUMN item_category_id INT NULL AFTER category`);
    // Backfill from existing category ENUM
    await p.query(
      `UPDATE inv_items i JOIN inv_item_categories ic ON ic.type = i.category
       SET i.item_category_id = ic.id WHERE i.item_category_id IS NULL`
    );
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
