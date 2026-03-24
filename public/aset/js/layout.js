(function () {
  'use strict';

  const APP_NAME = 'Aset';
  const NAV = [
    { href: '/aset', icon: '📊', label: 'Dashboard', page: 'aset-home' },
    { href: '/aset/daftar', icon: '🏗️', label: 'Daftar Aset', page: 'aset-daftar' },
    { href: '/aset/kategori', icon: '🗂️', label: 'Kategori', page: 'aset-kategori' },
    { href: '/aset/pemeliharaan', icon: '🔧', label: 'Pemeliharaan', page: 'aset-pemeliharaan' },
    { href: '/aset/laporan', icon: '📈', label: 'Laporan', page: 'aset-laporan' },
  ];

  function getActivePage() { return document.body.dataset.page || ''; }

  function renderSidebarItems(nav) {
    const active = getActivePage();
    return nav.map(item => `
      <a href="${item.href}" class="sidebar-item${item.page === active ? ' active' : ''}">
        <span class="icon">${item.icon}</span>
        <span class="label">${item.label}</span>
      </a>`).join('');
  }

  function renderBottomNavItems(nav) {
    const active = getActivePage();
    return nav.map(item => `
      <a href="${item.href}" class="bottom-nav-item${item.page === active ? ' active' : ''}">
        <span class="bottom-nav-icon">${item.icon}</span>
        ${item.label.split(' ')[0]}
      </a>`).join('');
  }

  function injectNavbar(user) {
    const ph = document.getElementById('navbar-placeholder');
    if (!ph) return;
    const roleChip = user.role === 'super_admin' ? 'Super Admin' : 'Finance';
    ph.outerHTML = `
      <nav class="navbar">
        <a href="/apps" class="navbar-brand" title="Kembali ke Cakra ERP">
          <img src="/assets/logo/logo-CSK.png" alt="Cakra" class="navbar-brand-logo" />
          <div class="navbar-brand-text">
            <div class="brand-name"><span>Cakra</span> ERP</div>
            <div class="brand-sub">${APP_NAME}</div>
          </div>
        </a>
        <div class="navbar-body">
          <div class="navbar-page-title" id="navPageTitle"></div>
          <div class="navbar-user">
            <span class="navbar-greeting">
              Halo, <strong id="navName">${user.fullName}</strong>
              <span class="chip">${roleChip}</span>
            </span>
            <a href="/apps" class="btn btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:.3rem">
              <span style="font-size:.85rem">⊞</span> Apps
            </a>
            <button class="btn btn-ghost btn-sm" id="logoutBtn">Keluar</button>
          </div>
        </div>
      </nav>`;
  }

  function injectSidebar() {
    const ph = document.getElementById('sidebar-placeholder');
    if (!ph) return;
    const active = getActivePage();
    const activeItem = NAV.find(i => i.page === active);
    ph.outerHTML = `
      <aside class="sidebar">
        <div class="sidebar-section-label" style="padding:.6rem 1.1rem .3rem;font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--gray-400)">${APP_NAME}</div>
        ${renderSidebarItems(NAV)}
      </aside>`;
    if (activeItem) {
      const el = document.getElementById('navPageTitle');
      if (el) el.textContent = activeItem.label;
    }
  }

  function injectBottomNav() {
    const ph = document.getElementById('bottom-nav-placeholder');
    if (!ph) return;
    ph.outerHTML = `<nav class="bottom-nav">${renderBottomNavItems(NAV.slice(0, 5))}</nav>`;
  }

  async function initLayout() {
    let user;
    try {
      const me = await fetch('/api/auth/me').then(r => r.json());
      if (!me.userId) { window.location.href = '/login'; return; }
      user = me;
      window.currentUser = me;
    } catch { window.location.href = '/login'; return; }

    if (user.role === 'employee') { window.location.href = '/duitkau/dashboard'; return; }

    injectNavbar(user);
    injectSidebar();
    injectBottomNav();
    document.getElementById('modals-placeholder')?.remove();
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });

    if (window.onLayoutReady) window.onLayoutReady(user);
  }

  document.addEventListener('DOMContentLoaded', initLayout);
})();
