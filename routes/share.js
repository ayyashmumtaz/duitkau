const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

const caSelect = `
  SELECT ca.*,
    req.full_name AS request_by_name,
    opn.full_name AS open_by_name,
    cls.full_name AS closed_by_name,
    pr.name AS project_name
  FROM cash_advances ca
  LEFT JOIN users req ON ca.request_by = req.id
  LEFT JOIN users opn ON ca.open_by = opn.id
  LEFT JOIN users cls ON ca.closed_by = cls.id
  LEFT JOIN projects pr ON ca.project_id = pr.id
`;

// ─── POST /ca/:id — generate public CA share link ────────────
router.post('/ca/:id', requireLogin, async (req, res) => {
  try {
    const ca = await db.getAsync('SELECT * FROM cash_advances WHERE id = ?', [req.params.id]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });
    if (req.session.role !== 'finance' && req.session.role !== 'super_admin' && ca.request_by !== req.session.userId)
      return res.status(403).json({ error: 'Akses ditolak' });

    const paramsStr = JSON.stringify({ type: 'ca', caId: ca.id });
    const existing = await db.getAsync('SELECT token FROM share_tokens WHERE params = ?', [paramsStr]);
    if (existing) {
      return res.json({ token: existing.token, url: `/ca-view.html?token=${existing.token}` });
    }

    const token = crypto.randomBytes(20).toString('hex');
    await db.runAsync('INSERT INTO share_tokens (token, params, label) VALUES (?, ?, ?)', [token, paramsStr, ca.title]);
    res.json({ token, url: `/ca-view.html?token=${token}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat link' });
  }
});

// ─── GET /ca/:token — public CA view (no auth) ───────────────
router.get('/ca/:token', async (req, res) => {
  try {
    const row = await db.getAsync('SELECT * FROM share_tokens WHERE token = ?', [req.params.token]);
    if (!row) return res.status(404).json({ error: 'Link tidak valid' });
    const p = JSON.parse(row.params);
    if (p.type !== 'ca' || !p.caId) return res.status(400).json({ error: 'Link tidak valid' });

    const ca = await db.getAsync(`${caSelect} WHERE ca.id = ?`, [p.caId]);
    if (!ca) return res.status(404).json({ error: 'CA tidak ditemukan' });

    const txs = await db.allAsync(
      `SELECT t.*, c.name AS category_name, pr2.name AS project_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN projects pr2 ON t.project_id = pr2.id
       WHERE t.ca_id = ? AND t.status = 'approved'
       ORDER BY t.date DESC, t.created_at DESC`,
      [p.caId]
    );
    const approvals = await db.allAsync(
      `SELECT caa.type, caa.status, caa.decided_at, caa.reject_reason, u.full_name AS approver_name
       FROM ca_approvals caa
       JOIN users u ON caa.approver_id = u.id
       WHERE caa.ca_id = ?
       ORDER BY caa.type, caa.created_at`,
      [p.caId]
    );
    res.json({ ...ca, transactions: txs, approvals, label: row.label });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data CA' });
  }
});

// User generates a share token (finance can share any, employee only their own)
router.post('/', requireLogin, async (req, res) => {
  let { userId, periodType, periodValue, projectId, categoryId, caId, label } = req.body;
  
  if (req.session.role !== 'finance') {
    userId = req.session.userId;
  }
  
  const params = JSON.stringify({
    userId: userId || 'all',
    periodType: periodType || 'month',
    periodValue: periodValue || '',
    projectId: projectId || '',
    categoryId: categoryId || '',
    caId: caId || ''
  });
  const token = crypto.randomBytes(20).toString('hex');
  try {
    await db.runAsync('INSERT INTO share_tokens (token, params, label) VALUES (?, ?, ?)', [token, params, label || null]);
    res.json({ token, url: `/view.html?token=${token}` });
  } catch { res.status(500).json({ error: 'Gagal membuat link' }); }
});

// Public: get report by token (no auth required)
router.get('/:token', async (req, res) => {
  try {
    const row = await db.getAsync('SELECT * FROM share_tokens WHERE token = ?', [req.params.token]);
    if (!row) return res.status(404).json({ error: 'Link tidak valid' });
    const p = JSON.parse(row.params);

    let whereClauses = ["t.status = 'approved'"];
    let params = [];
    if (p.userId && p.userId !== 'all') { whereClauses.push('t.user_id = ?'); params.push(p.userId); }
    if (p.projectId) { whereClauses.push('t.project_id = ?'); params.push(p.projectId); }
    if (p.categoryId) { whereClauses.push('t.category_id = ?'); params.push(p.categoryId); }
    if (p.caId) { whereClauses.push('t.ca_id = ?'); params.push(p.caId); }
    if (p.periodType === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(p.periodValue)) { whereClauses.push("t.date = ?"); params.push(p.periodValue); }
    else if (p.periodType === 'month' && /^\d{4}-\d{2}$/.test(p.periodValue)) { whereClauses.push("DATE_FORMAT(t.date, '%Y-%m') = ?"); params.push(p.periodValue); }
    else if (p.periodType === 'year' && /^\d{4}$/.test(p.periodValue)) { whereClauses.push("DATE_FORMAT(t.date, '%Y') = ?"); params.push(p.periodValue); }

    const where = 'WHERE ' + whereClauses.join(' AND ');
    const rows = await db.allAsync(
      `SELECT t.*, u.username, u.full_name, pr.name as project_name, c.name as category_name, ca.title as ca_title
       FROM transactions t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN projects pr ON t.project_id = pr.id
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN cash_advances ca ON t.ca_id = ca.id
       ${where} ORDER BY u.full_name, t.date DESC`,
      params
    );

    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.user_id]) grouped[r.user_id] = { userId: r.user_id, username: r.username, fullName: r.full_name, transactions: [], totalMasuk: 0, totalKeluar: 0 };
      grouped[r.user_id].transactions.push({ id: r.id, type: r.type, name: r.name, amount: r.amount, date: r.date, note: r.note, proof_image: r.proof_image, project_name: r.project_name, category_name: r.category_name, ca_title: r.ca_title });
      if (r.type === 'masuk') grouped[r.user_id].totalMasuk += r.amount;
      else grouped[r.user_id].totalKeluar += r.amount;
    }
    const data = Object.values(grouped).map(e => ({ ...e, net: e.totalMasuk - e.totalKeluar }));
    res.json({ label: row.label, params: p, data, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

module.exports = router;
