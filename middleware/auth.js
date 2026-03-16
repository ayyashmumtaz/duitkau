function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireFinance(req, res, next) {
  if (req.session.role !== 'finance') {
    return res.status(403).json({ error: 'Forbidden: finance role required' });
  }
  next();
}

module.exports = { requireLogin, requireFinance };
