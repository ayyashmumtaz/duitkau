// ─── Inject global modals once ────────────────────────────────
(function injectGlobalModals() {
  function doInject() {
    if (document.getElementById('_globalConfirmOverlay')) return;

  const html = `
    <!-- Global Confirm Modal -->
    <div class="modal-overlay" id="_globalConfirmOverlay" style="z-index:9000">
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title" id="_globalConfirmTitle">Konfirmasi</span>
        </div>
        <div class="modal-body">
          <div id="_globalConfirmBody" style="font-size:.9rem;line-height:1.7;color:var(--gray-600)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="_globalConfirmCancel">Batal</button>
          <button class="btn btn-primary" id="_globalConfirmOk">Ya, Lanjutkan</button>
        </div>
      </div>
    </div>

    <!-- Global Alert Modal -->
    <div class="modal-overlay" id="_globalAlertOverlay" style="z-index:9001">
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <span class="modal-title" id="_globalAlertTitle">Perhatian</span>
          <button class="modal-close" id="_globalAlertClose">✕</button>
        </div>
        <div class="modal-body">
          <div id="_globalAlertBody" style="font-size:.9rem;line-height:1.7;color:var(--gray-600)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="_globalAlertOk">OK</button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);

  // Confirm wiring
  let _confirmResolve = null;
  const closeConfirm = (val) => {
    document.getElementById('_globalConfirmOverlay').classList.remove('open');
    if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null; }
  };
  document.getElementById('_globalConfirmOk').addEventListener('click', () => closeConfirm(true));
  document.getElementById('_globalConfirmCancel').addEventListener('click', () => closeConfirm(false));
  document.getElementById('_globalConfirmOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('_globalConfirmOverlay')) closeConfirm(false);
  });

  window._globalConfirmResolve = (r) => { _confirmResolve = r; };

  // Alert wiring
  let _alertResolve = null;
  const closeAlert = () => {
    document.getElementById('_globalAlertOverlay').classList.remove('open');
    if (_alertResolve) { _alertResolve(); _alertResolve = null; }
  };
  document.getElementById('_globalAlertOk').addEventListener('click', closeAlert);
  document.getElementById('_globalAlertClose').addEventListener('click', closeAlert);
  document.getElementById('_globalAlertOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('_globalAlertOverlay')) closeAlert();
  });

  window._globalAlertResolve = (r) => { _alertResolve = r; };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doInject);
  } else {
    doInject();
  }
})();

// ─── Public API ───────────────────────────────────────────────

/**
 * modalConfirm(title, bodyHtml, options?)
 * options: { okText, okClass, cancelText }
 * Returns Promise<boolean>
 */
function modalConfirm(title, bodyHtml, options = {}) {
  return new Promise(resolve => {
    window._globalConfirmResolve(resolve);
    document.getElementById('_globalConfirmTitle').textContent = title;
    document.getElementById('_globalConfirmBody').innerHTML = bodyHtml || '';
    const okBtn = document.getElementById('_globalConfirmOk');
    okBtn.textContent = options.okText || 'Ya, Lanjutkan';
    okBtn.className = 'btn ' + (options.okClass || 'btn-primary');
    const cancelBtn = document.getElementById('_globalConfirmCancel');
    cancelBtn.textContent = options.cancelText || 'Batal';
    cancelBtn.style.display = options.cancelText === false ? 'none' : '';
    document.getElementById('_globalConfirmOverlay').classList.add('open');
  });
}

/**
 * modalAlert(message, title?)
 * Returns Promise (resolves on OK)
 */
function modalAlert(message, title = 'Perhatian') {
  return new Promise(resolve => {
    window._globalAlertResolve(resolve);
    document.getElementById('_globalAlertTitle').textContent = title;
    document.getElementById('_globalAlertBody').innerHTML =
      typeof message === 'string' ? message.replace(/\n/g, '<br>') : message;
    document.getElementById('_globalAlertOverlay').classList.add('open');
  });
}

// Aliases for legacy usage
function showConfirm(title, bodyHtml, options = {}) { return modalConfirm(title, bodyHtml, options); }
function initConfirmModal() {}
