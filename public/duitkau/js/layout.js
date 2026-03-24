(function () {
  'use strict';

  // ─── Navigation items ─────────────────────
  const EMPLOYEE_NAV = [
    { href: '/duitkau/dashboard', icon: '📝', label: 'Input Reimburse',   page: 'dashboard' },
    { href: '/duitkau/history',   icon: '📋', label: 'Riwayat',           page: 'history'   },
    { href: '/duitkau/ca',        icon: '💰', label: 'Cash Advance',      page: 'ca', notif: true },
  ];

  // Finance nav with collapsible groups
  const FINANCE_NAV_GROUPS = [
    { type: 'item', href: '/duitkau/finance', icon: '📊', label: 'Dashboard', page: 'finance' },
    {
      type: 'group', label: 'Transaksi', icon: '💳',
      items: [
        { href: '/duitkau/input-personal',      icon: '👤', label: 'Reimburse Pribadi',    page: 'input-personal'      },
        { href: '/duitkau/input-employee',      icon: '👥', label: 'Input Karyawan',        page: 'input-employee'      },
        { href: '/duitkau/reimburse-approval',  icon: '💸', label: 'Persetujuan Reimburse', page: 'reimburse-approval', reimburseNotif: true },
        { href: '/duitkau/ca',                  icon: '💰', label: 'Cash Advance',          page: 'ca', notif: true     },
      ]
    },
    {
      type: 'group', label: 'Laporan', icon: '📋',
      items: [
        { href: '/duitkau/reports', icon: '📊', label: 'Laporan Transaksi', page: 'reports' },
      ]
    },
    { type: 'item', href: '/duitkau/projects', icon: '📁', label: 'Proyek', page: 'projects' },
    { type: 'item', href: '/duitkau/logs', icon: '📜', label: 'Event Log', page: 'logs' },
  ];

  // Finance bottom-nav (mobile)
  const FINANCE_BOTTOM = [
    { href: '/duitkau/finance',         icon: '📊', label: 'Dashboard',  page: 'finance'         },
    { href: '/duitkau/input-personal',  icon: '👤', label: 'Pribadi',    page: 'input-personal'  },
    { href: '/duitkau/input-employee',  icon: '👥', label: 'Karyawan',   page: 'input-employee'  },
    { href: '/duitkau/ca',              icon: '💰', label: 'Cash Adv.',  page: 'ca', notif: true },
    { href: '/duitkau/reports',         icon: '📊', label: 'Laporan',    page: 'reports'         },
  ];

  let _dbOk = true;
  let _notifOpen = false;

  // ─── Expose DB status for page scripts ────
  window.getDbOk = () => _dbOk;

  // ─── Helpers ──────────────────────────────
  function getActivePage() { return document.body.dataset.page || ''; }

  function renderNavItem(item, activeClass = '') {
    let badge = '';
    if (item.notif)          badge = '<span class="sidebar-notif ca-notif-sidebar" style="display:none">0</span>';
    if (item.reimburseNotif) badge = '<span class="sidebar-notif reimburse-notif-sidebar" style="display:none">0</span>';
    return `
      <a href="${item.href}" class="sidebar-item${activeClass}">
        <span class="icon">${item.icon}</span>
        <span class="label">${item.label}</span>
        ${badge}
      </a>`;
  }

  function renderSidebarItems(navOrGroups) {
    const active = getActivePage();
    return navOrGroups.map(entry => {
      if (entry.type === 'group') {
        const hasActive = entry.items.some(i => i.page === active);
        const children = entry.items.map(item =>
          renderNavItem(item, ' sidebar-child' + (item.page === active ? ' active' : ''))
        ).join('');
        return `
          <div class="sidebar-group" data-group="open">
            <button class="sidebar-group-header${hasActive ? ' has-active' : ''}" type="button">
              <span class="icon">${entry.icon}</span>
              <span class="label">${entry.label}</span>
              <span class="chevron">▾</span>
            </button>
            <div class="sidebar-group-body">${children}</div>
          </div>`;
      }
      return renderNavItem(entry, entry.page === active ? ' active' : '');
    }).join('');
  }

  function renderBottomNavItems(items) {
    const active = getActivePage();
    return items.map(item => `
      <a href="${item.href}" class="bottom-nav-item${item.page === active ? ' active' : ''}">
        <span class="bottom-nav-icon" ${item.notif ? 'style="position:relative"' : ''}>
          ${item.icon}
          ${item.notif ? '<span class="bottom-notif ca-notif-bottom" style="display:none">0</span>' : ''}
        </span>
        ${item.label.split(' ')[0]}
      </a>`).join('');
  }

  // ─── Inject navbar ────────────────────────
  function injectNavbar(user) {
    const ph = document.getElementById('navbar-placeholder');
    if (!ph) return;
    const isFinanceOrAdmin = user.role === 'finance' || user.role === 'super_admin';
    const roleChip = user.role === 'super_admin' ? 'Super Admin' : (user.role === 'finance' ? 'Finance' : 'Karyawan');
    ph.outerHTML = `
      <div class="db-banner" id="dbBanner">
        <span class="db-dot"></span>
        Database tidak terhubung — semua operasi dinonaktifkan
      </div>
      <nav class="navbar">
        <a href="/apps.html" class="navbar-brand" title="Kembali ke Cakra ERP">
          <img src="/assets/logo/logo-CSK.png" alt="Cakra" class="navbar-brand-logo" />
          <div class="navbar-brand-text">
            <div class="brand-name"><span>Cakra</span> ERP</div>
            <div class="brand-sub">DuitKau</div>
          </div>
        </a>
        <div class="navbar-body">
        <div class="navbar-page-title" id="navPageTitle"></div>
        <div class="navbar-user">
          <span id="dbIndicator" class="db-status-indicator connected" title="Status Database">
            <span class="dot"></span> DB
          </span>
          <span class="navbar-greeting">
            Halo, <strong id="navName">${user.fullName}</strong>
            <span class="chip">${roleChip}</span>
          </span>
          <div style="position:relative">
            <button class="notif-btn" id="notifBell" title="Notifikasi CA">
              🔔<span class="notif-count" id="notifBadge" style="display:none">0</span>
            </button>
            <div class="notif-popup" id="notifPopup" style="display:none"></div>
          </div>
          ${isFinanceOrAdmin
            ? '<button class="btn btn-ghost btn-sm" id="profileBtn">Edit Profil</button>'
            : '<button class="btn btn-ghost btn-sm" id="pwdBtn">Ubah Password</button>'}
          <a href="/apps.html" class="btn btn-ghost btn-sm" title="Kembali ke menu aplikasi" style="display:inline-flex;align-items:center;gap:.3rem">
            <span style="font-size:.85rem">⊞</span> Apps
          </a>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">Keluar</button>
        </div>
        </div>
      </nav>`;
  }

  // ─── Inject sidebar ───────────────────────
  function injectSidebar(user) {
    const ph = document.getElementById('sidebar-placeholder');
    if (!ph) return;
    const nav = user.role === 'employee' ? EMPLOYEE_NAV : FINANCE_NAV_GROUPS;
    ph.outerHTML = `<aside class="sidebar">${renderSidebarItems(nav)}</aside>`;

    // Set navbar page title from active nav item
    const active = getActivePage();
    const allItems = [];
    nav.forEach(e => e.type === 'group' ? allItems.push(...e.items) : allItems.push(e));
    const activeItem = allItems.find(i => i.page === active);
    if (activeItem) {
      const el = document.getElementById('navPageTitle');
      if (el) el.textContent = activeItem.label;
    }

    // Wire group toggle buttons
    document.querySelectorAll('.sidebar-group-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.sidebar-group');
        group.dataset.group = group.dataset.group === 'open' ? 'closed' : 'open';
      });
    });
  }

  // ─── Inject bottom nav ────────────────────
  function injectBottomNav(user) {
    const ph = document.getElementById('bottom-nav-placeholder');
    if (!ph) return;
    const items = (user.role === 'finance' || user.role === 'super_admin') ? FINANCE_BOTTOM : EMPLOYEE_NAV;
    ph.outerHTML = `<nav class="bottom-nav">${renderBottomNavItems(items)}</nav>`;
  }

  // ─── Inject modals (password / profile) ───
  function injectModals(user) {
    const ph = document.getElementById('modals-placeholder');
    if (!ph) return;
    if (user.role === 'employee') {
      ph.outerHTML = `
        <div class="modal-overlay" id="pwdOverlay">
          <div class="modal">
            <div class="modal-header">
              <span class="modal-title">Ubah Password</span>
              <button class="modal-close" id="pwdClose">✕</button>
            </div>
            <div class="modal-body">
              <div id="pwdAlert" class="alert alert-error"></div>
              <div id="pwdSuccess" class="alert alert-success"></div>
              <div class="form-group">
                <label for="pwdNew">Password Baru</label>
                <input type="password" id="pwdNew" placeholder="Minimal 6 karakter" />
              </div>
              <div class="form-group">
                <label for="pwdConfirm">Konfirmasi Password</label>
                <input type="password" id="pwdConfirm" placeholder="Ulangi password baru" />
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="pwdCancel">Batal</button>
              <button class="btn btn-primary" id="pwdSave">Simpan</button>
            </div>
          </div>
        </div>`;
    } else {
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
                <small class="text-muted" style="margin-top:.25rem;display:block">Minimal 6 karakter jika diisi</small>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" id="profileCancel">Batal</button>
              <button class="btn btn-primary" id="profileSave">Simpan</button>
            </div>
          </div>
        </div>`;
    }
  }

  // ─── DB Status ────────────────────────────
  async function checkDb() {
    try { const r = await fetch('/api/health'); _dbOk = (await r.json()).db; } catch { _dbOk = false; }
    const banner = document.getElementById('dbBanner');
    const ind = document.getElementById('dbIndicator');
    if (!banner) return;
    if (!_dbOk) {
      banner.classList.add('show');
      if (ind) { ind.className = 'db-status-indicator disconnected'; ind.innerHTML = '<span class="dot"></span> DB Mati'; }
    } else {
      banner.classList.remove('show');
      if (ind) { ind.className = 'db-status-indicator connected'; ind.innerHTML = '<span class="dot"></span> DB'; }
    }
    if (window.onDbStatusChange) window.onDbStatusChange(_dbOk);
  }

  // ─── Notifications ────────────────────────
  async function checkNotifications() {
    try {
      const [caData, rdData] = await Promise.all([
        fetch('/api/ca/notify').then(r => r.json()).catch(() => ({ count: 0 })),
        fetch('/api/transactions/reimburse-count').then(r => r.json()).catch(() => ({ count: 0 })),
      ]);
      const caCount = caData.count || 0;
      const rcCount = rdData.count || 0;
      const total   = caCount + rcCount;
      const label   = total > 9 ? '9+' : String(total);
      const show    = total > 0;

      // Bell badge (total)
      const badge = document.getElementById('notifBadge');
      if (badge) { badge.textContent = label; badge.style.display = show ? '' : 'none'; }

      // CA sidebar/bottom badges
      const caLabel = caCount > 9 ? '9+' : String(caCount);
      document.querySelectorAll('.ca-notif-sidebar').forEach(el => { el.textContent = caLabel; el.style.display = caCount > 0 ? '' : 'none'; });
      document.querySelectorAll('.ca-notif-bottom').forEach(el => { el.textContent = caLabel; el.style.display = caCount > 0 ? '' : 'none'; });

      // Reimburse sidebar badge
      const rcLabel = rcCount > 9 ? '9+' : String(rcCount);
      document.querySelectorAll('.reimburse-notif-sidebar').forEach(el => { el.textContent = rcLabel; el.style.display = rcCount > 0 ? '' : 'none'; });
    } catch {}
  }

  async function loadNotifPopup(user) {
    const popup = document.getElementById('notifPopup');
    if (!popup) return;
    popup.innerHTML = '<div class="notif-popup-empty">🔄 Memuat...</div>';
    try {
      const cas = await fetch('/api/ca').then(r => r.json());
      const fmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
      let items = [];
      if (user.role === 'finance' || user.role === 'super_admin') {
        items = cas.filter(ca =>
          ca.status === 'pending' || ca.status === 'pending_close' ||
          ca.reimbursement_status === 'pending' || ca.refund_status === 'pending'
        );
      } else {
        items = cas.filter(ca =>
          ca.status === 'open' ||
          ca.status === 'rejected' ||
          (ca.status === 'closed' && !ca.reimbursement_status) ||
          ca.reimbursement_status === 'rejected'
        );
      }

      const STATUS_DESC = {
        pending:       '⏳ Menunggu persetujuan',
        pending_close: '🔒 Request penutupan CA',
        open:          '✅ CA aktif — siap digunakan',
        rejected:      '❌ CA ditolak',
        closed:        '🏁 Ditutup — ajukan reimburse',
      };

      // Pending votes for current user
      const myVotes = await fetch('/api/ca/my-pending-votes').then(r => r.json()).catch(() => []);

      // Pending reimburse batches from employees (finance only)
      let pendingReimburse = [];
      if (user.role === 'finance' || user.role === 'super_admin') {
        pendingReimburse = await fetch('/api/transactions/pending-batches').then(r => r.ok ? r.json() : []).catch(() => []);
      }

      let html = '<div class="notif-popup-header">Notifikasi</div>';

      if (myVotes.length > 0) {
        html += '<div style="font-size:.75rem;font-weight:600;padding:.4rem .75rem;color:var(--gray-500);background:var(--gray-50)">Perlu Persetujuan Anda</div>';
        html += myVotes.map(v => `
          <div class="notif-popup-item" onclick="window.location.href='/duitkau/ca?id=${v.ca_id}'">
            <div style="font-weight:600;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.title}</div>
            <div style="font-size:.75rem;color:var(--gray-500)">${v.type === 'open' ? '🔑 Menunggu persetujuan CA' : '💸 Menunggu persetujuan reimburse'}</div>
            <div style="font-size:.75rem;color:var(--gray-400)">${fmt.format(v.initial_amount)} · ${v.request_by_name}</div>
          </div>`).join('');
      }

      if (pendingReimburse.length > 0) {
        html += `<div style="font-size:.75rem;font-weight:600;padding:.4rem .75rem;color:var(--gray-500);background:var(--gray-50)">Reimburse Menunggu Pembayaran</div>`;
        html += pendingReimburse.map(b => `
          <div class="notif-popup-item" onclick="window.location.href='/duitkau/reimburse-approval'">
            <div style="font-weight:600;font-size:.82rem">${b.full_name}</div>
            <div style="font-size:.75rem;color:var(--gray-500)">💸 ${b.transactions.length} klaim · ${fmt.format(b.total)}</div>
          </div>`).join('');
      }

      if (items.length === 0 && myVotes.length === 0 && pendingReimburse.length === 0) {
        html += '<div class="notif-popup-empty">✅ Tidak ada notifikasi</div>';
      } else if (items.length > 0) {
        if (myVotes.length > 0) html += '<div style="font-size:.75rem;font-weight:600;padding:.4rem .75rem;color:var(--gray-500);background:var(--gray-50)">Informasi CA</div>';
        html += items.map(ca => {
          let desc = STATUS_DESC[ca.status] || ca.status;
          if (ca.refund_status === 'pending') {
            desc = '↩️ Pengembalian dana menunggu konfirmasi';
          } else if (ca.status === 'open' && ca.close_reject_reason) {
            desc = `⚠️ Close ditolak: "${ca.close_reject_reason}"`;
          } else if (ca.reimbursement_status === 'pending') {
            desc = ca.pending_reimburse_approvals > 0 ? `💸 Reimburse menunggu ${ca.pending_reimburse_approvals} approver` : '💸 Reimburse menunggu diproses';
          } else if (ca.reimbursement_status === 'rejected') {
            desc = `❌ Reimburse ditolak: "${ca.reimbursement_reject_reason || ''}"`;
          } else if (ca.status === 'pending' && ca.pending_open_approvals > 0) {
            desc = `⏳ Menunggu ${ca.pending_open_approvals} persetujuan`;
          }
          return `
          <div class="notif-popup-item" onclick="window.location.href='/duitkau/ca?id=${ca.id}'">
            <div style="font-weight:600;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ca.title}</div>
            <div style="font-size:.75rem;color:var(--gray-500)">${desc}</div>
            <div style="font-size:.75rem;color:var(--gray-400)">${fmt.format(ca.initial_amount)}${(user.role === 'finance' || user.role === 'super_admin') && ca.request_by_name ? ' · ' + ca.request_by_name : ''}</div>
          </div>`;
        }).join('');
      }
      if (items.length > 0 || myVotes.length > 0) {
        html += '<a href="/duitkau/ca" class="notif-popup-footer">Lihat semua CA →</a>';
      }
      if (pendingReimburse.length > 0) {
        html += '<a href="/duitkau/reimburse-approval" class="notif-popup-footer">Lihat semua reimburse →</a>';
      }
      popup.innerHTML = html;
    } catch {
      popup.innerHTML = '<div class="notif-popup-empty" style="color:var(--red)">Gagal memuat notifikasi</div>';
    }
  }

  // ─── Wire bell popup ──────────────────────
  function wireNotifBell(user) {
    const bell = document.getElementById('notifBell');
    const popup = document.getElementById('notifPopup');
    if (!bell || !popup) return;
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      _notifOpen = !_notifOpen;
      popup.style.display = _notifOpen ? '' : 'none';
      if (_notifOpen) loadNotifPopup(user);
    });
    document.addEventListener('click', (e) => {
      if (_notifOpen && !popup.contains(e.target) && e.target !== bell) {
        _notifOpen = false;
        popup.style.display = 'none';
      }
    });
  }

  // ─── Wire logout ──────────────────────────
  function wireLogout() {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // ─── Wire password modal ──────────────────
  function wirePasswordModal() {
    const overlay = document.getElementById('pwdOverlay');
    if (!overlay) return;
    const sa = (id, msg) => { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show'); } };
    const ha = (id) => document.getElementById(id)?.classList.remove('show');
    const close = () => overlay.classList.remove('open');
    document.getElementById('pwdBtn')?.addEventListener('click', () => {
      document.getElementById('pwdNew').value = '';
      document.getElementById('pwdConfirm').value = '';
      ha('pwdAlert'); ha('pwdSuccess');
      overlay.classList.add('open');
    });
    document.getElementById('pwdClose')?.addEventListener('click', close);
    document.getElementById('pwdCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('pwdSave')?.addEventListener('click', async () => {
      ha('pwdAlert'); ha('pwdSuccess');
      const pwd = document.getElementById('pwdNew').value;
      const conf = document.getElementById('pwdConfirm').value;
      if (!pwd || pwd.length < 6) { sa('pwdAlert', 'Password minimal 6 karakter'); return; }
      if (pwd !== conf) { sa('pwdAlert', 'Konfirmasi password tidak cocok'); return; }
      const btn = document.getElementById('pwdSave');
      btn.disabled = true; btn.textContent = 'Menyimpan...';
      try {
        const res = await fetch('/api/auth/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
        const data = await res.json();
        if (!res.ok) { sa('pwdAlert', data.error); return; }
        sa('pwdSuccess', 'Password berhasil diubah');
        setTimeout(close, 1500);
      } catch { sa('pwdAlert', 'Gagal menyimpan'); }
      finally { btn.disabled = false; btn.textContent = 'Simpan'; }
    });
  }

  // ─── Wire profile modal (finance) ─────────
  function wireProfileModal() {
    const overlay = document.getElementById('profileOverlay');
    if (!overlay) return;
    const sa = (id, msg) => { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show'); } };
    const ha = (id) => document.getElementById(id)?.classList.remove('show');
    const close = () => overlay.classList.remove('open');
    document.getElementById('profileBtn')?.addEventListener('click', () => {
      fetch('/api/auth/me').then(r => r.json()).then(d => {
        document.getElementById('profileName').value = d.fullName;
        document.getElementById('profileUsername').value = d.username;
        document.getElementById('profilePassword').value = '';
        ha('profileAlert'); ha('profileSuccess');
        overlay.classList.add('open');
      });
    });
    document.getElementById('profileClose')?.addEventListener('click', close);
    document.getElementById('profileCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('profileSave')?.addEventListener('click', async () => {
      ha('profileAlert'); ha('profileSuccess');
      const body = {
        full_name: document.getElementById('profileName').value.trim(),
        username: document.getElementById('profileUsername').value.trim(),
        password: document.getElementById('profilePassword').value,
      };
      const btn = document.getElementById('profileSave');
      btn.disabled = true; btn.textContent = 'Menyimpan...';
      try {
        const res = await fetch('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) { sa('profileAlert', data.error); return; }
        document.getElementById('navName').textContent = data.fullName;
        sa('profileSuccess', 'Profil berhasil diperbarui');
        setTimeout(close, 1500);
      } catch { sa('profileAlert', 'Gagal menyimpan'); }
      finally { btn.disabled = false; btn.textContent = 'Simpan'; }
    });
  }

  // ─── Main init ────────────────────────────
  async function initLayout() {
    // Auth check
    let user;
    try {
      const me = await fetch('/api/auth/me').then(r => r.json());
      if (!me.userId) { window.location.href = '/login'; return; }
      user = me;
      window.currentUser = me;
    } catch { window.location.href = '/login'; return; }

    // Role guard
    const page = getActivePage();
    if ((user.role === 'finance' || user.role === 'super_admin') && (page === 'dashboard' || page === 'history')) {
      window.location.href = '/duitkau/finance'; return;
    }
    if (user.role === 'employee' && ['finance','input-employee','input-personal','employees','projects','categories','reports','logs'].includes(page)) {
      window.location.href = '/duitkau/dashboard'; return;
    }

    // Inject layout pieces
    injectNavbar(user);
    injectSidebar(user);
    injectBottomNav(user);
    injectModals(user);

    // Wire shared interactions
    wireLogout();
    wireNotifBell(user);
    wirePasswordModal();
    wireProfileModal();

    // Start polling
    await checkDb();
    setInterval(checkDb, 15000);
    checkNotifications();
    setInterval(checkNotifications, 30000);

    // Call page-specific init
    if (window.onLayoutReady) window.onLayoutReady(user);
  }

  document.addEventListener('DOMContentLoaded', initLayout);
})();
