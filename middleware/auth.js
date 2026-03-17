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

function requireFinanceOrSuperAdmin(req, res, next) {
  if (req.session.role !== 'finance' && req.session.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: finance or super_admin role required' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.session.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: super_admin role required' });
  }
  next();
}

module.exports = { requireLogin, requireFinance, requireFinanceOrSuperAdmin, requireSuperAdmin };
