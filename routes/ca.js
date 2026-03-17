const express = require('express');
const db = require('../database');
const upload = require('../middleware/upload');
const { requireLogin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();
router.use(requireLogin);

const caSelect = `
  SELECT ca.*,
    req.full_name  AS request_by_name,
    opn.full_name  AS open_by_name,
    cls.full_name  AS closed_by_name,
    crq.full_name  AS close_requested_by_name,
    rmb.full_name  AS reimbursement_by_name,
    pr.name        AS project_name,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.ca_id=ca.id AND t.type='masuk' AND t.status='approved'),0) AS total_masuk_ca,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.ca_id=ca.id AND t.type='keluar' AND t.status='approved'),0) AS total_keluar_ca
  FROM cash_advances ca
  LEFT JOIN users req ON ca.request_by = req.id
  LEFT JOIN users opn ON ca.open_by    = opn.id
  LEFT JOIN users cls ON ca.closed_by  = cls.id
  LEFT JOIN users crq ON ca.close_requested_by = crq.id
  LEFT JOIN users rmb ON ca.reimbursement_by   = rmb.id
  LEFT JOIN projects pr ON ca.project_id = pr.id
`;

// ─── GET /notify — notification count ────────────────────────
router.get('/notify', async (req, res) => {
  try {
    let count = 0;
    if (req.session.role === 'finance') {
      const r = await db.getAsync(
        `SELECT COUNT(*) as n FROM cash_advances
         WHERE status IN ('pending','pending_close') OR reimbursement_status = 'pending'`
      );
      count = r.n;
    } else {
      const r = await db.getAsync(
        `SELECT COUNT(*) as n FROM cash_advances
         WHERE request_by = ? AND (
           status = 'open' OR
           status = 'rejected' OR
           (status = 'closed' AND reimbursement_status IS NULL) OR
           reimbursement_status = 'rejected'
         )`,
        [req.session.userId]
      );
      count = r.n;
    }
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ count: 0 });
  }
});

// ─── GET / — list CAs ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let rows;
    if (req.session.role === 'finance') {
      rows = await db.allAsync(`${caSelect} ORDER BY ca.created_at DESC`);
    } else {
      rows = await db.allAsync(
        `${caSelect} WHERE ca.request_by = ? ORDER BY ca.created_at DESC`,
        [req.session.userId]
      );
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data CA' });
  }
});

// ─── POST / — create CA (employee: pending, finance: auto-open)
router.post('/', async (req, res) => {
  const { title, description, initial_amount, project_id } = req.body;
  if (!title || !title.trim())
    return res.status(400).json({ error: 'Judul CA wajib diisi' });
  const amount = parseFloat(initial_amount);
  if (isNaN(amount) || amount <= 0)
    return res.status(400).json({ error: 'Nominal CA harus berupa angka positif' });

  const projectId = project_id ? parseInt(project_id) || null : null;
  const isFinance = req.session.role === 'finance';

  try {
    let result;
    if (isFinance) {
      result = await db.runAsync(
        `INSERT INTO cash_advances (title, description, initial_amount, project_id, request_by, status, open_by, open_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, datetime('now','localtime'))`,
        [title.trim(), description || null, amount, projectId, req.session.userId, req.session.userId]
      );
    } else {
      result = await db.runAsync(
        `INSERT INTO cash_advances (title, description, initial_amount, project_id, request_by)
         VALUES (?, ?, ?, ?, ?)`,
        [title.trim(), description || null, amount, projectId, req.session.userId]
      );
    }
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [result.lastID]);
    logEvent(req, 'CREATE_CA', `${isFinance ? 'Finance' : 'Karyawan'} mengajukan CA "${row.title}" sebesar ${row.initial_amount}`);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan CA' });
  }
});

// ─── GET /:id — detail + transactions ─────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const ca = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (req.session.role !== 'finance' && ca.request_by !== req.session.userId)
      return res.status(403).json({ error: 'Akses ditolak' });

    const txs = await db.allAsync(
      `SELECT t.*, c.name AS category_name, pr.name AS project_name, ib.full_name AS input_by_name
       FROM transactions t
       LEFT JOIN categories c  ON t.category_id = c.id
       LEFT JOIN projects   pr ON t.project_id  = pr.id
       LEFT JOIN users      ib ON t.input_by    = ib.id
       WHERE t.ca_id = ?
       ORDER BY t.date DESC, t.created_at DESC`,
      [req.params.id]
    );
    res.json({ ...ca, transactions: txs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail CA' });
  }
});

// ─── PUT /:id — finance edits CA ──────────────────────────────
router.put('/:id', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa mengedit CA' });

  const { title, description, initial_amount, project_id } = req.body;
  if (!title || !title.trim())
    return res.status(400).json({ error: 'Judul CA wajib diisi' });
  
  const amount = parseFloat(initial_amount);
  if (isNaN(amount) || amount <= 0)
    return res.status(400).json({ error: 'Nominal CA harus berupa angka positif' });

  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });

    // Cek apakah transaksinya sudah melebihi jumlah yang baru? Biarkan saja finance menanggung resikonya.
    await db.runAsync(
      `UPDATE cash_advances SET title=?, description=?, initial_amount=?, project_id=? WHERE id=?`,
      [title.trim(), description || null, amount, project_id ? parseInt(project_id) || null : null, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'UPDATE_CA', `Finance mengubah data CA (ID: ${req.params.id}) menjadi "${row.title}" sebesar ${row.initial_amount}`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengupdate CA' });
  }
});

// ─── PATCH /:id/approve — finance opens CA ────────────────────
router.patch('/:id/approve', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa menyetujui CA' });
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.status !== 'pending')
      return res.status(400).json({ error: 'CA tidak dalam status pending' });

    await db.runAsync(
      `UPDATE cash_advances SET status='open', open_by=?, open_at=datetime('now','localtime') WHERE id=?`,
      [req.session.userId, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    
    logEvent(req, 'APPROVE_CA', `Finance menyetujui CA "${row.title}"`);
    
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyetujui CA' });
  }
});

// ─── PATCH /:id/reject — finance rejects CA ───────────────────
router.patch('/:id/reject', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa menolak CA' });
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.status !== 'pending')
      return res.status(400).json({ error: 'CA tidak dalam status pending' });

    await db.runAsync(
      `UPDATE cash_advances SET status='rejected' WHERE id=?`,
      [req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'REJECT_CA', `Finance menolak CA "${row.title}"`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menolak CA' });
  }
});

// ─── PATCH /:id/request-close — request close (owner only) ───
router.patch('/:id/request-close', async (req, res) => {
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.request_by !== req.session.userId)
      return res.status(403).json({ error: 'Akses ditolak' });
    if (ca.status !== 'open')
      return res.status(400).json({ error: 'CA tidak dalam status open' });

    const note = req.body.note || null;
    // Finance closing their own CA: skip approval, directly closed
    if (req.session.role === 'finance') {
      await db.runAsync(
        `UPDATE cash_advances SET status='closed', closed_by=?, closed_at=datetime('now','localtime'), close_reject_reason=NULL WHERE id=?`,
        [req.session.userId, req.params.id]
      );
      const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
      logEvent(req, 'CLOSE_CA', `Finance menutup CA-nya sendiri "${row.title}"`);
      return res.json(row);
    }
    await db.runAsync(
      `UPDATE cash_advances SET status='pending_close',
        close_requested_by=?, close_requested_at=datetime('now','localtime'), close_request_note=?,
        close_reject_reason=NULL
       WHERE id=?`,
      [req.session.userId, note, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'REQUEST_CLOSE_CA', `Karyawan mengajukan penutupan CA "${row.title}"`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal request close CA' });
  }
});

// ─── PATCH /:id/reject-close — finance rejects close request ──
router.patch('/:id/reject-close', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa menolak permintaan close' });
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.status !== 'pending_close')
      return res.status(400).json({ error: 'CA tidak dalam status pending_close' });

    const reason = (req.body && req.body.reason) ? req.body.reason.trim() : null;
    await db.runAsync(
      `UPDATE cash_advances SET status='open',
        close_requested_by=NULL, close_requested_at=NULL, close_request_note=NULL,
        close_reject_reason=?
       WHERE id=?`,
      [reason, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'REJECT_CLOSE_CA', `Finance menolak penutupan CA "${row.title}"${reason ? ` — Alasan: ${reason}` : ''}`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menolak close CA' });
  }
});

// ─── PATCH /:id/approve-close — finance approves close ────────
router.patch('/:id/approve-close', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa menutup CA' });
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.status !== 'pending_close')
      return res.status(400).json({ error: 'CA tidak dalam status pending_close' });

    await db.runAsync(
      `UPDATE cash_advances SET status='closed',
        closed_by=?, closed_at=datetime('now','localtime')
       WHERE id=?`,
      [req.session.userId, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    
    logEvent(req, 'CLOSE_CA', `Finance menutup CA "${row.title}"`);
    
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menutup CA' });
  }
});

// ─── PATCH /:id/request-reimburse — request reimburse (owner)
router.patch('/:id/request-reimburse', async (req, res) => {
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.request_by !== req.session.userId)
      return res.status(403).json({ error: 'Akses ditolak' });
    if (ca.status !== 'closed')
      return res.status(400).json({ error: 'CA belum ditutup' });

    await db.runAsync(
      `UPDATE cash_advances SET reimbursement_requested=1, reimbursement_status='pending' WHERE id=?`,
      [req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'REQUEST_REIMBURSE_CA', `Mengajukan klaim reimburse untuk CA "${row.title}"`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal request reimburse' });
  }
});

// ─── PATCH /:id/approve-reimburse — finance approves reimburse
router.patch('/:id/approve-reimburse', upload.single('proof'), async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa memproses reimburse' });
  try {
    const ca = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.reimbursement_status !== 'pending')
      return res.status(400).json({ error: 'Tidak ada permintaan reimburse yang menunggu' });

    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0)
      return res.status(400).json({ error: 'Nominal reimburse harus berupa angka positif' });

    const kekurangan = Math.max(0, (ca.total_keluar_ca || 0) - (ca.total_masuk_ca || 0));
    if (kekurangan > 0 && Math.abs(amount - kekurangan) > 1)
      return res.status(400).json({ error: `Nominal reimburse harus sesuai kekurangan: Rp ${kekurangan.toLocaleString('id-ID')}` });

    const proof = req.file ? `/uploads/${req.file.filename}` : null;
    const note = req.body.note || null;

    await db.runAsync(
      `UPDATE cash_advances SET
        reimbursement_status='approved', reimbursement_amount=?, reimbursement_proof=?,
        reimbursement_by=?, reimbursement_at=datetime('now','localtime'),
        reimbursement_reject_reason=NULL
       WHERE id=?`,
      [amount, proof, req.session.userId, req.params.id]
    );
    // Store note in a temp field reuse or log
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'APPROVE_REIMBURSE_CA', `Finance menyetujui reimburse CA "${row.title}" sebesar ${amount}${note ? ` — Catatan: ${note}` : ''}`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses reimburse' });
  }
});

// ─── PATCH /:id/reject-reimburse — finance rejects reimburse ─
router.patch('/:id/reject-reimburse', async (req, res) => {
  if (req.session.role !== 'finance')
    return res.status(403).json({ error: 'Hanya finance yang bisa menolak reimburse' });
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (ca.reimbursement_status !== 'pending')
      return res.status(400).json({ error: 'Tidak ada permintaan reimburse yang menunggu' });

    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });

    await db.runAsync(
      `UPDATE cash_advances SET
        reimbursement_status='rejected', reimbursement_reject_reason=?,
        reimbursement_by=?, reimbursement_at=datetime('now','localtime')
       WHERE id=?`,
      [reason, req.session.userId, req.params.id]
    );
    const row = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [req.params.id]);
    logEvent(req, 'REJECT_REIMBURSE_CA', `Finance menolak reimburse CA "${row.title}" — Alasan: ${reason}`);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menolak reimburse' });
  }
});

module.exports = router;
