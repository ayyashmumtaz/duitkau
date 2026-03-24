(function () {
  'use strict';

  const HRD_NAV = [
    { href: '/hrd/karyawan', icon: '🪪', label: 'Data Karyawan', page: 'hrd-karyawan' },
  ];

  // ─── Helpers ──────────────────────────────
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

  // ─── Inject navbar ────────────────────────
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
            <div class="brand-sub">HRD</div>
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

  // ─── Inject sidebar ───────────────────────
  function injectSidebar() {
    const ph = document.getElementById('sidebar-placeholder');
    if (!ph) return;
    const active = getActivePage();
    const activeItem = HRD_NAV.find(i => i.page === active);
    ph.outerHTML = `
      <aside class="sidebar">
        <div class="sidebar-section-label" style="padding:.6rem 1.1rem .3rem;font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--gray-400)">HRD</div>
        ${renderSidebarItems(HRD_NAV)}
      </aside>`;
    if (activeItem) {
      const el = document.getElementById('navPageTitle');
      if (el) el.textContent = activeItem.label;
    }
  }

  // ─── Inject bottom nav ────────────────────
  function injectBottomNav() {
    const ph = document.getElementById('bottom-nav-placeholder');
    if (!ph) return;
    ph.outerHTML = `<nav class="bottom-nav">${renderBottomNavItems(HRD_NAV)}</nav>`;
  }

  // ─── Inject modals ────────────────────────
  function injectModals() {
    const ph = document.getElementById('modals-placeholder');
    if (!ph) return;
    ph.outerHTML = `
      <div class="modal-overlay" id="profileOverlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Edit Profil</span>
            <button class="modal-close" id="profileClose">✕</button>
          </div>
          <div class="modal-body">
            <div id="profileAlert" class="alert alert-error"></div>
            <div id="profileSuccess" class="alert alert-success"></div>
            <div class="form-group">
              <label for="profileName">Nama Lengkap</label>
              <input type="text" id="profileName" />
            </div>
            <div class="form-group">
              <label for="profileUsername">Username</label>
              <input type="text" id="profileUsername" />
            </div>
            <div class="form-group">
              <label for="profilePassword">Password Baru</label>
              <input type="password" id="profilePassword" placeholder="Kosongkan jika tidak ingin ubah" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" id="profileCancel">Batal</button>
            <button class="btn btn-primary" id="profileSave">Simpan</button>
          </div>
        </div>
      </div>`;
  }

  // ─── Wire logout ──────────────────────────
  function wireLogout() {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // ─── Main init ────────────────────────────
  async function initLayout() {
    let user;
    try {
      const me = await fetch('/api/auth/me').then(r => r.json());
      if (!me.userId) { window.location.href = '/login'; return; }
      user = me;
      window.currentUser = me;
    } catch { window.location.href = '/login'; return; }

    // Only finance + super_admin can access HRD
    if (user.role === 'employee') {
      window.location.href = '/dashboard';
      return;
    }

    injectNavbar(user);
    injectSidebar();
    injectBottomNav();
    injectModals();
    wireLogout();

    if (window.onLayoutReady) window.onLayoutReady(user);
  }

  document.addEventListener('DOMContentLoaded', initLayout);
})();
