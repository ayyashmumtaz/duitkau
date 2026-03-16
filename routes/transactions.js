const express = require('express');
const db = require('../database');
const upload = require('../middleware/upload');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.use(requireLogin);

router.get('/', async (req, res) => {
  const { month } = req.query;
  try {
    let rows;
    const baseSelect = `SELECT t.*, pr.name as project_name, c.name as category_name,
       ib.full_name as input_by_name
       FROM transactions t
       LEFT JOIN projects pr ON t.project_id = pr.id
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN users ib ON t.input_by = ib.id`;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      rows = await db.allAsync(
        `${baseSelect} WHERE t.user_id = ? AND strftime('%Y-%m', t.date) = ?
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
    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan transaksi' });
  }
});

// Batch insert — accepts multipart: items (JSON string) + proof_0, proof_1, ... files
router.post('/batch', upload.any(), async (req, res) => {
  let items;
  try { items = JSON.parse(req.body.items); } catch {
    return res.status(400).json({ error: 'Format data tidak valid' });
  }
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Minimal 1 transaksi' });

  const fileMap = {};
  for (const file of (req.files || [])) fileMap[file.fieldname] = `/uploads/${file.filename}`;

  try {
    await db.runAsync('BEGIN TRANSACTION');
    const insertedList = [];
    for (let i = 0; i < items.length; i++) {
      const { name, amount, date, note, project_id, category_id, ca_id } = items[i];
      const parsedAmount = parseFloat(amount);
      if (!name?.trim() || isNaN(parsedAmount) || parsedAmount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        await db.runAsync('ROLLBACK');
        return res.status(400).json({ error: `Item ${i + 1}: data tidak valid` });
      }
      if (!category_id) {
        await db.runAsync('ROLLBACK');
        return res.status(400).json({ error: `Item ${i + 1}: kategori wajib dipilih` });
      }
      const proofImage = fileMap[`proof_${i}`] || null;
      if (!proofImage) {
        await db.runAsync('ROLLBACK');
        return res.status(400).json({ error: `Item ${i + 1}: bukti foto wajib disertakan` });
      }
      const projectId = project_id ? parseInt(project_id) || null : null;
      const categoryId = parseInt(category_id);
      const caId = ca_id ? parseInt(ca_id) || null : null;
      const result = await db.runAsync(
        `INSERT INTO transactions (user_id, type, name, amount, date, note, proof_image, status, input_by, project_id, category_id, ca_id)
         VALUES (?, 'keluar', ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
        [req.session.userId, name.trim(), parsedAmount, date, note || null, proofImage, req.session.userId, projectId, categoryId, caId]
      );
      const inserted = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
      insertedList.push(inserted);
    }
    await db.runAsync('COMMIT');
    res.status(201).json(insertedList);
  } catch (err) {
    await db.runAsync('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan batch transaksi' });
  }
});

module.exports = router;
