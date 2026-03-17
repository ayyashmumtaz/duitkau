const express = require('express');
const db = require('../database');
const upload = require('../middleware/upload');
const { requireLogin, requireFinanceOrSuperAdmin } = require('../middleware/auth');
const { logEvent } = require('../utils/logger');

const router = express.Router();

router.use(requireLogin, requireFinanceOrSuperAdmin);

// ─── Laporan semua karyawan (hanya approved) ─────────────────
router.get('/summary', async (req, res) => {
  const { month } = req.query;
  try {
    let rows;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      rows = await db.allAsync(
        `SELECT t.*, u.username, u.full_name, pr.name as project_name, c.name as category_name FROM transactions t
         JOIN users u ON t.user_id = u.id
         LEFT JOIN projects pr ON t.project_id = pr.id
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.status = 'approved' AND strftime('%Y-%m', t.date) = ?
         ORDER BY u.full_name, t.date DESC`,
        [month]
      );
    } else {
      rows = await db.allAsync(
        `SELECT t.*, u.username, u.full_name, pr.name as project_name, c.name as category_name FROM transactions t
         JOIN users u ON t.user_id = u.id
         LEFT JOIN projects pr ON t.project_id = pr.id
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.status = 'approved'
         ORDER BY u.full_name, t.date DESC`
      );
    }
    res.json(groupByEmployee(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data laporan' });
  }
});

// ─── Pengajuan masuk dari karyawan ───────────────────────────
router.get('/pengajuan', async (req, res) => {
  try {
    const rows = await db.allAsync(
      `SELECT t.*, u.username, u.full_name FROM transactions t
       JOIN users u ON t.user_id = u.id
       WHERE t.status = 'pending'
       ORDER BY t.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil pengajuan' });
  }
});

// ─── Pengajuan pending count ──────────────────────────────────
router.get('/pengajuan/count', async (req, res) => {
  try {
    const row = await db.getAsync("SELECT COUNT(*) as count FROM transactions WHERE status = 'pending'");
    res.json({ count: row.count });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil jumlah pengajuan' });
  }
});

// ─── Approve / Reject pengajuan ──────────────────────────────
router.patch('/pengajuan/:id', async (req, res) => {
  const { action, review_note } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ error: 'Action tidak valid' });

  try {
    const tx = await db.getAsync("SELECT * FROM transactions WHERE id = ? AND status = 'pending'", [req.params.id]);
    if (!tx) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await db.runAsync(
      `UPDATE transactions SET status = ?, review_note = ?, input_by = ? WHERE id = ?`,
      [newStatus, review_note || null, req.session.userId, req.params.id]
    );

    const updated = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    
    logEvent(req, 'UPDATE_TX_STATUS', `Status pengajuan "${updated.name}" diubah menjadi ${newStatus}`);
    
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses pengajuan' });
  }
});

// ─── Finance input langsung untuk karyawan (approved) ────────
router.post('/input-employee', upload.single('proof_image'), async (req, res) => {
  const { userId, type, name, amount, date, note, project_id, category_id, ca_id } = req.body;

  if (!userId) return res.status(400).json({ error: 'Karyawan wajib dipilih' });
  if (!['masuk', 'keluar'].includes(type))
    return res.status(400).json({ error: 'Tipe transaksi tidak valid' });
  if (!name || name.trim().length === 0)
    return res.status(400).json({ error: 'Nama transaksi wajib diisi' });
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ error: 'Nominal harus berupa angka positif' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Format tanggal tidak valid' });
  if (!category_id)
    return res.status(400).json({ error: 'Kategori wajib dipilih' });

  try {
    const emp = await db.getAsync("SELECT id FROM users WHERE id = ?", [userId]);
    if (!emp) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    const proofImage = req.file ? `/uploads/${req.file.filename}` : null;
    const projectId = project_id ? parseInt(project_id) || null : null;
    const categoryId = parseInt(category_id);
    const caId = ca_id ? parseInt(ca_id) || null : null;

    const result = await db.runAsync(
      `INSERT INTO transactions (user_id, type, name, amount, date, note, proof_image, status, input_by, project_id, category_id, ca_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      [userId, type, name.trim(), parsedAmount, date, note || null, proofImage, req.session.userId, projectId, categoryId, caId]
    );

    const inserted = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
    
    logEvent(req, 'FINANCE_INPUT_TX', `Finance input transaksi "${inserted.name}" untuk karyawan ID ${userId} (${type})`);
    
    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan transaksi' });
  }
});

// ─── Laporan detail dengan filter fleksibel (hanya approved) ─
router.get('/report', async (req, res) => {
  const { userId, periodType, periodValue, projectId, categoryId, caId } = req.query;
  try {
    let whereClauses = ["t.status = 'approved'"];
    let params = [];

    if (userId && userId !== 'all') {
      whereClauses.push('t.user_id = ?');
      params.push(userId);
    }
    if (projectId) {
      whereClauses.push('t.project_id = ?');
      params.push(projectId);
    }
    if (categoryId) {
      whereClauses.push('t.category_id = ?');
      params.push(categoryId);
    }
    if (caId) {
      whereClauses.push('t.ca_id = ?');
      params.push(caId);
    }
    if (periodType === 'date' && periodValue && /^\d{4}-\d{2}-\d{2}$/.test(periodValue)) {
      whereClauses.push("t.date = ?"); params.push(periodValue);
    } else if (periodType === 'month' && periodValue && /^\d{4}-\d{2}$/.test(periodValue)) {
      whereClauses.push("strftime('%Y-%m', t.date) = ?"); params.push(periodValue);
    } else if (periodType === 'year' && periodValue && /^\d{4}$/.test(periodValue)) {
      whereClauses.push("strftime('%Y', t.date) = ?"); params.push(periodValue);
    }

    const where = 'WHERE ' + whereClauses.join(' AND ');
    const rows = await db.allAsync(
      `SELECT t.*, u.username, u.full_name, pr.name as project_name, c.name as category_name, ca.title as ca_title FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN projects pr ON t.project_id = pr.id
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN cash_advances ca ON t.ca_id = ca.id ${where}
       ORDER BY u.full_name, t.date DESC`,
      params
    );
    res.json(groupByEmployee(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data laporan' });
  }
});

// ─── Daftar semua user (untuk dropdown input transaksi) ──────
router.get('/employees', async (req, res) => {
  try {
    const users = await db.allAsync(
      "SELECT id, username, full_name, role FROM users ORDER BY role DESC, full_name"
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data karyawan' });
  }
});

router.get('/months', async (req, res) => {
  try {
    const months = await db.allAsync(
      `SELECT DISTINCT strftime('%Y-%m', date) as month FROM transactions ORDER BY month DESC`
    );
    res.json(months.map(m => m.month));
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data bulan' });
  }
});

// ─── Helper ───────────────────────────────────────────────────
function groupByEmployee(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.user_id]) {
      grouped[row.user_id] = {
        userId: row.user_id, username: row.username, fullName: row.full_name,
        transactions: [], totalMasuk: 0, totalKeluar: 0,
      };
    }
    grouped[row.user_id].transactions.push({
      id: row.id, type: row.type, name: row.name, amount: row.amount,
      date: row.date, note: row.note, proof_image: row.proof_image, created_at: row.created_at,
      project_name: row.project_name, category_name: row.category_name, ca_title: row.ca_title,
    });
    if (row.type === 'masuk') grouped[row.user_id].totalMasuk += row.amount;
    else grouped[row.user_id].totalKeluar += row.amount;
  }
  return Object.values(grouped).map(e => ({ ...e, net: e.totalMasuk - e.totalKeluar }));
}

// ─── Hapus Transaksi (HANYA FINANCE) ─────────────────────────
router.delete('/delete-transaction/:id', async (req, res) => {
  try {
    const txId = req.params.id;
    const tx = await db.getAsync('SELECT id FROM transactions WHERE id = ?', [txId]);
    if (!tx) {
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }
    
    await db.runAsync('DELETE FROM transactions WHERE id = ?', [txId]);
    
    logEvent(req, 'DELETE_TX', `Finance menghapus transaksi (ID: ${txId})`);
    
    res.json({ message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus transaksi' });
  }
});

module.exports = router;
