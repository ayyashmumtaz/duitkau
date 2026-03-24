// ── Inventory Workshop — Layout Injector ──────────────────────
(function () {
  const NAV = [
    { href: '/inventory',              icon: '📊', label: 'Dashboard',     page: 'dashboard' },
    { href: '/inventory/items',        icon: '📦', label: 'Master Barang', page: 'items' },
    { href: '/inventory/locations',    icon: '📍', label: 'Lokasi & Rak',  page: 'locations' },
    { href: '/inventory/borrow',       icon: '🔧', label: 'Peminjaman',    page: 'borrow' },
    { href: '/inventory/transactions', icon: '📋', label: 'Riwayat',       page: 'transactions' },
  ];

  const BOTTOM_NAV = [
    { href: '/inventory',              icon: '📊', label: 'Dashboard', page: 'dashboard' },
    { href: '/inventory/items',        icon: '📦', label: 'Barang',    page: 'items' },
    { href: '/inventory/locations',    icon: '📍', label: 'Lokasi',    page: 'locations' },
    { href: '/inventory/borrow',       icon: '🔧', label: 'Pinjam',    page: 'borrow' },
    { href: '/inventory/transactions', icon: '📋', label: 'Riwayat',   page: 'transactions' },
  ];

  const TYPE_LABEL = { warehouse: 'Gudang', vehicle: 'Mobil', workbench: 'Meja Kerja', area: 'Area' };

  function activePage() { return document.body.dataset.page || ''; }

  // ── Navbar ────────────────────────────────────────────────
  function injectNavbar(user) {
    const el = document.getElementById('navbar-placeholder');
    if (!el) return;
    el.outerHTML = `
      <nav class="navbar">
        <a href="/apps" class="navbar-brand" title="Kembali ke Apps">
          <img src="/assets/logo/logo-CSK.png" alt="Cakra" class="navbar-brand-logo" onerror="this.style.display='none'" />
          <div class="navbar-brand-text">
            <div class="brand-name"><span>Inventory</span></div>
            <div class="brand-sub">Workshop</div>
          </div>
        </a>
        <div class="navbar-body">
          <div class="navbar-page-title" id="navPageTitle"></div>
          <div class="navbar-user">
            <span id="dbIndicator" class="db-status-indicator connected" title="Status Database">
              <span class="dot"></span> DB
            </span>
            <span class="navbar-greeting">Halo, <strong>${user.fullName}</strong><span class="chip">Inventory</span></span>
            <a href="/apps" class="btn btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:.3rem">
              <span style="font-size:.85rem">⊞</span> Apps
            </a>
            <button class="btn btn-ghost btn-sm" id="navLogoutBtn">Keluar</button>
          </div>
        </div>
      </nav>`;

    document.getElementById('navLogoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login';
    });
  }

  // ── Sidebar ───────────────────────────────────────────────
  function injectSidebar() {
    const el = document.getElementById('sidebar-placeholder');
    if (!el) return;
    const cur   = activePage();
    const items = NAV.map(item => {
      const active = item.page === cur ? ' active' : '';
      return `<a href="${item.href}" class="sidebar-item${active}">
        <span class="icon">${item.icon}</span>
        <span class="label">${item.label}</span>
      </a>`;
    }).join('');

    el.outerHTML = `<aside class="sidebar">${items}</aside>`;

    const activeItem = NAV.find(i => i.page === cur);
    const title = document.getElementById('navPageTitle');
    if (title && activeItem) title.textContent = activeItem.label;
  }

  // ── Bottom Nav ────────────────────────────────────────────
  function injectBottomNav() {
    const el = document.getElementById('bottom-nav-placeholder');
    if (!el) return;
    const cur   = activePage();
    const items = BOTTOM_NAV.map(item => {
      const active = item.page === cur ? ' active' : '';
      return `<a href="${item.href}" class="bottom-nav-item${active}">
        <span class="bottom-nav-icon">${item.icon}</span>
        ${item.label}
      </a>`;
    }).join('');
    el.outerHTML = `<nav class="bottom-nav">${items}</nav>`;
  }

  // ── DB status ─────────────────────────────────────────────
  function checkDb() {
    fetch('/api/health').then(r => r.json()).then(d => {
      const el = document.getElementById('dbIndicator');
      if (el) el.className = `db-status-indicator ${d.db ? 'connected' : 'disconnected'}`;
    }).catch(() => {
      const el = document.getElementById('dbIndicator');
      if (el) el.className = 'db-status-indicator disconnected';
    });
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { location.href = '/login'; return; }
      const user = await res.json();

      // Only finance/super_admin can access inventory management
      if (!['finance', 'super_admin'].includes(user.role)) {
        location.href = '/apps';
        return;
      }

      injectNavbar(user);
      injectSidebar();
      injectBottomNav();
      checkDb();
      setInterval(checkDb, 30000);

      window._invUser = user;
      if (typeof window.onLayoutReady === 'function') window.onLayoutReady(user);
    } catch {
      location.href = '/login';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Exposed helpers ───────────────────────────────────────
  window.INV_TYPE_LABEL = TYPE_LABEL;
})();
