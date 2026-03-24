const express = require('express');
const db      = require('../database');
const { requireLogin, requireFinanceOrSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();
router.use(requireLogin);

// helper: cek finance/admin
const isManager = req => ['finance','super_admin'].includes(req.session?.role);

// ─── LOCATIONS ────────────────────────────────────────────────
router.get('/locations', async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT l.*, COUNT(r.id) as rack_count
       FROM inv_locations l
       LEFT JOIN inv_racks r ON r.location_id = l.id
       GROUP BY l.id ORDER BY l.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/locations', requireFinanceOrSuperAdmin, async (req, res) => {
  const { name, type, qr_code, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama lokasi wajib diisi' });
  if (!['warehouse','vehicle','workbench','area'].includes(type))
    return res.status(400).json({ error: 'Tipe tidak valid' });
  try {
    const r = await db.runAsync(
      `INSERT INTO inv_locations (name, type, qr_code, notes) VALUES (?, ?, ?, ?)`,
      [name.trim(), type, qr_code || null, notes || null]
    );
    const row = await db.getAsync('SELECT * FROM inv_locations WHERE id = ?', [r.lastID]);
    logEvent(req, 'INV_CREATE_LOCATION', `Lokasi "${name}" dibuat`);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/locations/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  const { name, type, qr_code, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama lokasi wajib diisi' });
  try {
    await db.runAsync(
      `UPDATE inv_locations SET name=?, type=?, qr_code=?, notes=? WHERE id=?`,
      [name.trim(), type, qr_code || null, notes || null, req.params.id]
    );
    res.json(await db.getAsync('SELECT * FROM inv_locations WHERE id=?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/locations/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  try {
    const racks = await db.allAsync('SELECT id FROM inv_racks WHERE location_id=?', [req.params.id]);
    if (racks.length) return res.status(400).json({ error: 'Hapus semua rak di lokasi ini dulu' });
    await db.runAsync('DELETE FROM inv_locations WHERE id=?', [req.params.id]);
    logEvent(req, 'INV_DELETE_LOCATION', `Lokasi ID ${req.params.id} dihapus`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RACKS ────────────────────────────────────────────────────
router.get('/racks', async (req, res) => {
  const { location_id } = req.query;
  try {
    let rows;
    if (location_id) {
      rows = await db.allAsync(
        `SELECT r.*, l.name as location_name FROM inv_racks r
         JOIN inv_locations l ON l.id = r.location_id
         WHERE r.location_id = ? ORDER BY r.name`, [location_id]
      );
    } else {
      rows = await db.allAsync(
        `SELECT r.*, l.name as location_name FROM inv_racks r
         JOIN inv_locations l ON l.id = r.location_id ORDER BY l.name, r.name`
      );
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/racks', requireFinanceOrSuperAdmin, async (req, res) => {
  const { location_id, name, notes } = req.body;
  if (!location_id) return res.status(400).json({ error: 'Lokasi wajib dipilih' });
  if (!name?.trim()) return res.status(400).json({ error: 'Nama rak wajib diisi' });
  try {
    const r = await db.runAsync(
      `INSERT INTO inv_racks (location_id, name, notes) VALUES (?, ?, ?)`,
      [location_id, name.trim(), notes || null]
    );
    const row = await db.getAsync(
      `SELECT r.*, l.name as location_name FROM inv_racks r
       JOIN inv_locations l ON l.id = r.location_id WHERE r.id=?`, [r.lastID]
    );
    logEvent(req, 'INV_CREATE_RACK', `Rak "${name}" di lokasi ID ${location_id}`);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/racks/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  const { name, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nama rak wajib diisi' });
  try {
    await db.runAsync(
      `UPDATE inv_racks SET name=?, notes=? WHERE id=?`,
      [name.trim(), notes || null, req.params.id]
    );
    res.json(await db.getAsync('SELECT * FROM inv_racks WHERE id=?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/racks/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  try {
    const hasStock = await db.getAsync(
      `SELECT id FROM inv_stock WHERE rack_id=? AND (qty > 0 OR qty_borrowed > 0) LIMIT 1`,
      [req.params.id]
    );
    if (hasStock) return res.status(400).json({ error: 'Rak masih memiliki stok' });
    await db.runAsync('DELETE FROM inv_racks WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ITEMS ────────────────────────────────────────────────────
router.get('/items', async (req, res) => {
  const { q, category } = req.query;
  try {
    let where = '1=1';
    const params = [];
    if (q)        { where += ' AND (i.name LIKE ? OR i.code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (category) { where += ' AND i.category = ?'; params.push(category); }

    const rows = await db.allAsync(
      `SELECT i.*,
         COALESCE(SUM(s.qty), 0)          as total_qty,
         COALESCE(SUM(s.qty_borrowed), 0) as total_borrowed,
         COALESCE(SUM(s.qty_damaged), 0)  as total_damaged,
         COALESCE(SUM(s.qty_lost), 0)     as total_lost
       FROM inv_items i
       LEFT JOIN inv_stock s ON s.item_id = i.id
       WHERE ${where}
       GROUP BY i.id
       ORDER BY i.name`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/items/:id', async (req, res) => {
  try {
    const item = await db.getAsync('SELECT * FROM inv_items WHERE id=?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan' });

    const stock = await db.allAsync(
      `SELECT s.*, r.name as rack_name, l.id as location_id, l.name as location_name, l.type as location_type
       FROM inv_stock s
       JOIN inv_racks r    ON r.id = s.rack_id
       JOIN inv_locations l ON l.id = r.location_id
       WHERE s.item_id = ? AND (s.qty > 0 OR s.qty_borrowed > 0 OR s.qty_damaged > 0 OR s.qty_lost > 0)
       ORDER BY l.name, r.name`, [req.params.id]
    );
    res.json({ item, stock });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/items', requireFinanceOrSuperAdmin, async (req, res) => {
  const { code, name, category, unit, min_stock, description } = req.body;
  if (!code?.trim())  return res.status(400).json({ error: 'Kode barang wajib diisi' });
  if (!name?.trim())  return res.status(400).json({ error: 'Nama barang wajib diisi' });
  if (!['tools','consumable'].includes(category))
    return res.status(400).json({ error: 'Kategori tidak valid' });
  try {
    const r = await db.runAsync(
      `INSERT INTO inv_items (code, name, category, unit, min_stock, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [code.trim().toUpperCase(), name.trim(), category, unit || 'pcs', parseInt(min_stock) || 0, description || null]
    );
    const row = await db.getAsync('SELECT * FROM inv_items WHERE id=?', [r.lastID]);
    logEvent(req, 'INV_CREATE_ITEM', `Barang "${name}" [${code}] kategori ${category}`);
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Kode barang sudah digunakan' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  const { code, name, category, unit, min_stock, description } = req.body;
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Kode dan nama wajib diisi' });
  try {
    await db.runAsync(
      `UPDATE inv_items SET code=?, name=?, category=?, unit=?, min_stock=?, description=? WHERE id=?`,
      [code.trim().toUpperCase(), name.trim(), category, unit || 'pcs', parseInt(min_stock) || 0, description || null, req.params.id]
    );
    res.json(await db.getAsync('SELECT * FROM inv_items WHERE id=?', [req.params.id]));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Kode barang sudah digunakan' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/items/:id', requireFinanceOrSuperAdmin, async (req, res) => {
  try {
    const hasStock = await db.getAsync(
      `SELECT id FROM inv_stock WHERE item_id=? AND (qty>0 OR qty_borrowed>0) LIMIT 1`, [req.params.id]
    );
    if (hasStock) return res.status(400).json({ error: 'Barang masih memiliki stok — lakukan adjustment ke 0 dulu' });
    await db.runAsync('DELETE FROM inv_items WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STOCK OPERATIONS ─────────────────────────────────────────

// Barang masuk
router.post('/stock/in', requireFinanceOrSuperAdmin, async (req, res) => {
  const { item_id, rack_id, qty, notes } = req.body;
  const q = parseFloat(qty);
  if (!item_id || !rack_id) return res.status(400).json({ error: 'Item dan rak wajib dipilih' });
  if (!q || q <= 0)         return res.status(400).json({ error: 'Qty harus lebih dari 0' });

  try {
    await db.transaction(async tx => {
      const stock  = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, rack_id]);
      const before = stock?.qty || 0;
      const after  = before + q;

      if (stock) {
        await tx.runAsync('UPDATE inv_stock SET qty=? WHERE item_id=? AND rack_id=?', [after, item_id, rack_id]);
      } else {
        await tx.runAsync('INSERT INTO inv_stock (item_id, rack_id, qty) VALUES (?, ?, ?)', [item_id, rack_id, after]);
      }
      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, qty, qty_before, qty_after, notes, created_by)
         VALUES ('in', ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, rack_id, q, before, after, notes || null, req.session.userId]
      );
    });
    const item = await db.getAsync('SELECT name FROM inv_items WHERE id=?', [item_id]);
    logEvent(req, 'INV_STOCK_IN', `Masuk ${q} ${item?.name} ke rack ID ${rack_id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Barang keluar (consumable)
router.post('/stock/out', requireFinanceOrSuperAdmin, async (req, res) => {
  const { item_id, rack_id, qty, notes } = req.body;
  const q = parseFloat(qty);
  if (!item_id || !rack_id) return res.status(400).json({ error: 'Item dan rak wajib dipilih' });
  if (!q || q <= 0)         return res.status(400).json({ error: 'Qty harus lebih dari 0' });

  try {
    await db.transaction(async tx => {
      const item = await tx.getAsync('SELECT * FROM inv_items WHERE id=?', [item_id]);
      if (!item) throw new Error('Barang tidak ditemukan');
      if (item.category === 'tools') throw new Error('Tools tidak bisa dikeluarkan — gunakan fitur Pinjam');

      const stock = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, rack_id]);
      if (!stock || stock.qty < q) throw new Error(`Stok tidak cukup (tersedia: ${stock?.qty || 0})`);

      const after = stock.qty - q;
      await tx.runAsync('UPDATE inv_stock SET qty=? WHERE item_id=? AND rack_id=?', [after, item_id, rack_id]);
      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, qty, qty_before, qty_after, notes, created_by)
         VALUES ('out', ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, rack_id, q, stock.qty, after, notes || null, req.session.userId]
      );
    });
    logEvent(req, 'INV_STOCK_OUT', `Keluar ${q} item ID ${item_id} dari rack ID ${rack_id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Transfer antar lokasi
router.post('/stock/transfer', requireFinanceOrSuperAdmin, async (req, res) => {
  const { item_id, from_rack_id, to_rack_id, qty, notes } = req.body;
  const q = parseFloat(qty);
  if (!item_id || !from_rack_id || !to_rack_id) return res.status(400).json({ error: 'Item, rak asal, dan rak tujuan wajib dipilih' });
  if (from_rack_id == to_rack_id) return res.status(400).json({ error: 'Rak asal dan tujuan tidak boleh sama' });
  if (!q || q <= 0) return res.status(400).json({ error: 'Qty harus lebih dari 0' });

  try {
    await db.transaction(async tx => {
      const src = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, from_rack_id]);
      if (!src || src.qty < q) throw new Error(`Stok tidak cukup di rak asal (tersedia: ${src?.qty || 0})`);

      const srcAfter = src.qty - q;
      await tx.runAsync('UPDATE inv_stock SET qty=? WHERE item_id=? AND rack_id=?', [srcAfter, item_id, from_rack_id]);

      const dst      = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, to_rack_id]);
      const dstAfter = (dst?.qty || 0) + q;
      if (dst) {
        await tx.runAsync('UPDATE inv_stock SET qty=? WHERE item_id=? AND rack_id=?', [dstAfter, item_id, to_rack_id]);
      } else {
        await tx.runAsync('INSERT INTO inv_stock (item_id, rack_id, qty) VALUES (?, ?, ?)', [item_id, to_rack_id, dstAfter]);
      }

      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, to_rack_id, qty, qty_before, qty_after, notes, created_by)
         VALUES ('transfer', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, from_rack_id, to_rack_id, q, src.qty, srcAfter, notes || null, req.session.userId]
      );
    });
    logEvent(req, 'INV_TRANSFER', `Transfer ${q} item ID ${item_id} dari rack ${from_rack_id} → ${to_rack_id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stock adjustment
router.post('/stock/adjustment', requireFinanceOrSuperAdmin, async (req, res) => {
  const { item_id, rack_id, qty_new, notes } = req.body;
  const qNew = parseFloat(qty_new);
  if (!item_id || !rack_id)       return res.status(400).json({ error: 'Item dan rak wajib dipilih' });
  if (isNaN(qNew) || qNew < 0)   return res.status(400).json({ error: 'Qty baru tidak valid' });
  if (!notes?.trim())             return res.status(400).json({ error: 'Alasan penyesuaian wajib diisi' });

  try {
    await db.transaction(async tx => {
      const stock  = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, rack_id]);
      const before = stock?.qty || 0;
      if (stock) {
        await tx.runAsync('UPDATE inv_stock SET qty=? WHERE item_id=? AND rack_id=?', [qNew, item_id, rack_id]);
      } else {
        await tx.runAsync('INSERT INTO inv_stock (item_id, rack_id, qty) VALUES (?, ?, ?)', [item_id, rack_id, qNew]);
      }
      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, qty, qty_before, qty_after, notes, created_by)
         VALUES ('adjustment', ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, rack_id, qNew - before, before, qNew, notes.trim(), req.session.userId]
      );
    });
    logEvent(req, 'INV_ADJUSTMENT', `Adjustment item ID ${item_id} rack ${rack_id}: → ${qNew}. Alasan: ${notes}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BORROWS (TOOLS) ──────────────────────────────────────────
router.get('/borrows', async (req, res) => {
  const { status = 'active' } = req.query;
  try {
    const rows = await db.allAsync(
      `SELECT b.*, i.name as item_name, i.code as item_code, i.unit,
         r.name as from_rack_name, l.name as from_location_name,
         rr.name as return_rack_name, lr.name as return_location_name
       FROM inv_borrows b
       JOIN inv_items i    ON i.id = b.item_id
       JOIN inv_racks r    ON r.id = b.from_rack_id
       JOIN inv_locations l ON l.id = r.location_id
       LEFT JOIN inv_racks rr    ON rr.id = b.return_rack_id
       LEFT JOIN inv_locations lr ON lr.id = rr.location_id
       WHERE b.status = ?
       ORDER BY b.borrowed_at DESC`, [status]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/borrows', requireFinanceOrSuperAdmin, async (req, res) => {
  const { item_id, from_rack_id, qty, borrower_name, expected_return, notes } = req.body;
  const q = parseInt(qty) || 1;
  if (!item_id || !from_rack_id)  return res.status(400).json({ error: 'Item dan rak wajib dipilih' });
  if (!borrower_name?.trim())     return res.status(400).json({ error: 'Nama peminjam wajib diisi' });
  if (q <= 0)                     return res.status(400).json({ error: 'Qty harus lebih dari 0' });

  try {
    let borrowId;
    await db.transaction(async tx => {
      const item = await tx.getAsync('SELECT * FROM inv_items WHERE id=?', [item_id]);
      if (!item)                     throw new Error('Barang tidak ditemukan');
      if (item.category !== 'tools') throw new Error('Hanya Tools yang dapat dipinjam');

      const stock     = await tx.getAsync('SELECT * FROM inv_stock WHERE item_id=? AND rack_id=?', [item_id, from_rack_id]);
      const available = (stock?.qty || 0) - (stock?.qty_borrowed || 0) - (stock?.qty_damaged || 0) - (stock?.qty_lost || 0);
      if (available < q) throw new Error(`Tools tersedia tidak cukup (tersedia: ${available})`);

      await tx.runAsync(
        'UPDATE inv_stock SET qty_borrowed = qty_borrowed + ? WHERE item_id=? AND rack_id=?',
        [q, item_id, from_rack_id]
      );

      const br = await tx.runAsync(
        `INSERT INTO inv_borrows (item_id, from_rack_id, qty, borrower_name, borrower_user_id, expected_return, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, from_rack_id, q, borrower_name.trim(), req.session.userId, expected_return || null, notes || null, req.session.userId]
      );
      borrowId = br.lastID;

      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, qty, qty_before, qty_after, ref_id, notes, created_by)
         VALUES ('borrow', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, from_rack_id, q, stock?.qty || 0, stock?.qty || 0, borrowId,
         `Dipinjam oleh ${borrower_name}`, req.session.userId]
      );
    });
    const row = await db.getAsync('SELECT * FROM inv_borrows WHERE id=?', [borrowId]);
    logEvent(req, 'INV_BORROW', `${borrower_name} meminjam ${q}x item ID ${item_id}`);
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/borrows/:id/return', requireFinanceOrSuperAdmin, async (req, res) => {
  const { return_rack_id, notes } = req.body;
  if (!return_rack_id) return res.status(400).json({ error: 'Rak tujuan pengembalian wajib dipilih' });

  try {
    await db.transaction(async tx => {
      const borrow = await tx.getAsync(
        "SELECT * FROM inv_borrows WHERE id=? AND status='active'", [req.params.id]
      );
      if (!borrow) throw new Error('Peminjaman tidak ditemukan atau sudah dikembalikan');

      await tx.runAsync(
        'UPDATE inv_stock SET qty_borrowed = GREATEST(0, qty_borrowed - ?) WHERE item_id=? AND rack_id=?',
        [borrow.qty, borrow.item_id, borrow.from_rack_id]
      );
      await tx.runAsync(
        `UPDATE inv_borrows SET status='returned', returned_at=NOW(), return_rack_id=?,
         notes=COALESCE(NULLIF(?, ''), notes) WHERE id=?`,
        [return_rack_id, notes || '', req.params.id]
      );
      await tx.runAsync(
        `INSERT INTO inv_transactions (type, item_id, rack_id, to_rack_id, qty, ref_id, notes, created_by)
         VALUES ('return', ?, ?, ?, ?, ?, ?, ?)`,
        [borrow.item_id, borrow.from_rack_id, return_rack_id, borrow.qty, borrow.id,
         `Dikembalikan oleh ${borrow.borrower_name}`, req.session.userId]
      );
    });
    logEvent(req, 'INV_RETURN', `Return pinjam ID ${req.params.id} ke rack ID ${return_rack_id}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TRANSACTIONS HISTORY ─────────────────────────────────────
router.get('/transactions', async (req, res) => {
  const { item_id, type, rack_id, from, to, limit = 100 } = req.query;
  try {
    const where = ['1=1'];
    const params = [];
    if (item_id) { where.push('t.item_id = ?');                   params.push(item_id); }
    if (type)    { where.push('t.type = ?');                      params.push(type); }
    if (rack_id) { where.push('(t.rack_id = ? OR t.to_rack_id = ?)'); params.push(rack_id, rack_id); }
    if (from)    { where.push('DATE(t.created_at) >= ?');          params.push(from); }
    if (to)      { where.push('DATE(t.created_at) <= ?');          params.push(to); }
    params.push(parseInt(limit) || 100);

    const rows = await db.allAsync(
      `SELECT t.*, i.name as item_name, i.code as item_code, i.unit, i.category,
         r.name as rack_name, l.name as location_name,
         rd.name as to_rack_name, ld.name as to_location_name,
         u.full_name as created_by_name
       FROM inv_transactions t
       JOIN inv_items i      ON i.id = t.item_id
       LEFT JOIN inv_racks r  ON r.id = t.rack_id
       LEFT JOIN inv_locations l ON l.id = r.location_id
       LEFT JOIN inv_racks rd  ON rd.id = t.to_rack_id
       LEFT JOIN inv_locations ld ON ld.id = rd.location_id
       LEFT JOIN users u       ON u.id = t.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT ?`, params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DASHBOARD STATS ──────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [totalItems, lowStock, activeBorrows, todayTx] = await Promise.all([
      db.getAsync('SELECT COUNT(*) as n FROM inv_items'),
      db.getAsync(
        `SELECT COUNT(*) as n FROM inv_items i
         WHERE i.min_stock > 0 AND i.min_stock >
           (SELECT COALESCE(SUM(s.qty), 0) FROM inv_stock s WHERE s.item_id = i.id)`
      ),
      db.getAsync("SELECT COUNT(*) as n FROM inv_borrows WHERE status='active'"),
      db.getAsync("SELECT COUNT(*) as n FROM inv_transactions WHERE DATE(created_at)=CURDATE()"),
    ]);

    const lowStockItems = await db.allAsync(
      `SELECT i.*, COALESCE(SUM(s.qty),0) as total_qty
       FROM inv_items i
       LEFT JOIN inv_stock s ON s.item_id = i.id
       WHERE i.min_stock > 0
       GROUP BY i.id
       HAVING COALESCE(SUM(s.qty),0) < i.min_stock
       ORDER BY (i.min_stock - COALESCE(SUM(s.qty),0)) DESC
       LIMIT 10`
    );

    const recentTx = await db.allAsync(
      `SELECT t.*, i.name as item_name, i.code as item_code,
         r.name as rack_name, l.name as location_name, u.full_name as created_by_name
       FROM inv_transactions t
       JOIN inv_items i      ON i.id = t.item_id
       LEFT JOIN inv_racks r  ON r.id = t.rack_id
       LEFT JOIN inv_locations l ON l.id = r.location_id
       LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.created_at DESC LIMIT 15`
    );

    res.json({
      stats: {
        totalItems:   totalItems.n,
        lowStock:     lowStock.n,
        activeBorrows: activeBorrows.n,
        todayTx:      todayTx.n,
      },
      lowStockItems,
      recentTx,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
