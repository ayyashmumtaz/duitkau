const express = require('express');
const db = require('../database');
const upload = require('../middleware/upload');
const { requireLogin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.use(requireLogin);

router.get('/', async (req, res) => {
  const { month } = req.query;
  try {
    let rows;
    const baseSelect = `SELECT t.*, pr.name as project_name, c.name as category_name, ca.title as ca_title,
       ib.full_name as input_by_name
       FROM transactions t
       LEFT JOIN projects pr ON t.project_id = pr.id
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN cash_advances ca ON t.ca_id = ca.id
       LEFT JOIN users ib ON t.input_by = ib.id`;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      rows = await db.allAsync(
        `${baseSelect} WHERE t.user_id = ? AND DATE_FORMAT(t.date, '%Y-%m') = ?
         ORDER BY t.date DESC, t.created_at DESC`,
        [req.session.userId, month]
      );
    } else {
      rows = await db.allAsync(
        `${baseSelect} WHERE t.user_id = ? ORDER BY t.date DESC, t.created_at DESC`,
        [req.session.userId]
      );
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

router.post('/', upload.single('proof_image'), async (req, res) => {
  const { name, amount, date, note, project_id, category_id } = req.body;

  if (!name || name.trim().length === 0)
    return res.status(400).json({ error: 'Nama transaksi wajib diisi' });
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ error: 'Nominal harus berupa angka positif' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Format tanggal tidak valid' });
  if (!category_id)
    return res.status(400).json({ error: 'Kategori wajib dipilih' });

  const proofImage = req.file ? `/uploads/${req.file.filename}` : null;
  const projectId = project_id ? parseInt(project_id) || null : null;
  const categoryId = parseInt(category_id);

  try {
    const result = await db.runAsync(
      `INSERT INTO transactions (user_id, type, name, amount, date, note, proof_image, status, input_by, project_id, category_id)
       VALUES (?, 'keluar', ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
      [req.session.userId, name.trim(), parsedAmount, date, note || null, proofImage, req.session.userId, projectId, categoryId]
    );
    const inserted = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
    logEvent(req, 'CREATE_TRANSACTION', `Menambahkan transaksi "${inserted.name}" sejumlah ${inserted.amount}`);
    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan transaksi' });
  }
});

// Batch insert — employee submission creates a reimburse_batch group
router.post('/batch', upload.any(), async (req, res) => {
  let items;
  try { items = JSON.parse(req.body.items); } catch {
    return res.status(400).json({ error: 'Format data tidak valid' });
  }
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Minimal 1 transaksi' });

  const fileMap = {};
  for (const file of (req.files || [])) fileMap[file.fieldname] = `/uploads/${file.filename}`;

  for (let i = 0; i < items.length; i++) {
    const { name, amount, date, category_id } = items[i];
    const parsedAmount = parseFloat(amount);
    if (!name?.trim() || isNaN(parsedAmount) || parsedAmount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: `Item ${i + 1}: data tidak valid` });
    if (!category_id)
      return res.status(400).json({ error: `Item ${i + 1}: kategori wajib dipilih` });
    if (!fileMap[`proof_${i}`])
      return res.status(400).json({ error: `Item ${i + 1}: bukti foto wajib disertakan` });
  }

  const isEmployee = req.session.role === 'employee';

  try {
    const insertedList = await db.transaction(async (tx) => {
      // Create a batch group if submitted by employee
      let batchId = null;
      if (isEmployee) {
        const br = await tx.runAsync(
          `INSERT INTO reimburse_batches (user_id, status) VALUES (?, 'pending')`,
          [req.session.userId]
        );
        batchId = br.lastID;
      }

      const list = [];
      for (let i = 0; i < items.length; i++) {
        const { name, amount, date, note, project_id, category_id, ca_id } = items[i];
        const proofImage = fileMap[`proof_${i}`];
        const projectId  = project_id ? parseInt(project_id) || null : null;
        const categoryId = parseInt(category_id);
        const caId       = ca_id ? parseInt(ca_id) || null : null;
        const txStatus   = isEmployee ? 'pending' : 'approved';
        const result = await tx.runAsync(
          `INSERT INTO transactions (user_id, type, name, amount, date, note, proof_image, status, input_by, project_id, category_id, ca_id, batch_id)
           VALUES (?, 'keluar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.session.userId, name.trim(), parseFloat(amount), date, note || null, proofImage, txStatus, req.session.userId, projectId, categoryId, caId, batchId]
        );
        const inserted = await tx.getAsync('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
        list.push(inserted);
      }
      return list;
    });

    logEvent(req, 'CREATE_BATCH_TRANSACTION', `Menambahkan ${items.length} transaksi sekaligus`);
    res.status(201).json(insertedList);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan batch transaksi' });
  }
});

// Finance: count pending reimburse batches (for sidebar badge)
router.get('/reimburse-count', async (req, res) => {
  if (req.session.role !== 'finance' && req.session.role !== 'super_admin')
    return res.json({ count: 0 });
  try {
    const r = await db.getAsync(
      `SELECT COUNT(*) as n FROM reimburse_batches rb
       WHERE rb.status = 'pending'
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.batch_id = rb.id)`
    );
    res.json({ count: r.n });
  } catch { res.json({ count: 0 }); }
});

// Finance: list reimburse batches with their transactions
router.get('/pending-batches', async (req, res) => {
  if (req.session.role !== 'finance' && req.session.role !== 'super_admin')
    return res.status(403).json({ error: 'Akses ditolak' });
  const status = req.query.status === 'approved' ? 'approved' : 'pending';
  try {
    const batches = await db.allAsync(
      `SELECT rb.*, u.full_name, u.username
       FROM reimburse_batches rb
       JOIN users u ON rb.user_id = u.id
       WHERE rb.status = ?
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.batch_id = rb.id)
       ORDER BY rb.submitted_at ${status === 'approved' ? 'DESC' : 'ASC'}`,
      [status]
    );
    for (const b of batches) {
      b.transactions = await db.allAsync(
        `SELECT t.*, c.name as category_name, pr.name as project_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN projects pr ON t.project_id = pr.id
         WHERE t.batch_id = ?
         ORDER BY t.date ASC`,
        [b.id]
      );
      b.total = b.transactions.reduce((s, t) => s + t.amount, 0);
    }
    res.json(batches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// Finance: approve entire batch (mark as paid)
router.put('/batches/:id/pay', async (req, res) => {
  if (req.session.role !== 'finance' && req.session.role !== 'super_admin')
    return res.status(403).json({ error: 'Akses ditolak' });
  try {
    const batch = await db.getAsync('SELECT * FROM reimburse_batches WHERE id = ?', [req.params.id]);
    if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan' });
    if (batch.status !== 'pending') return res.status(400).json({ error: 'Batch sudah diproses' });
    await db.transaction(async (tx) => {
      await tx.runAsync(
        `UPDATE reimburse_batches SET status='approved', approved_by=?, approved_at=NOW() WHERE id=?`,
        [req.session.userId, req.params.id]
      );
      await tx.runAsync(
        `UPDATE transactions SET status='approved' WHERE batch_id=?`,
        [req.params.id]
      );
    });
    logEvent(req, 'PAY_REIMBURSE_BATCH', `Menyetujui batch reimburse #${req.params.id} (${batch.user_id})`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui status' });
  }
});

module.exports = router;
