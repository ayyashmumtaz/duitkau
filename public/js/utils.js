let _confirmResolve = null;

function initConfirmModal() {
  const overlay = document.getElementById('confirmOverlay');
  if (!overlay) return;
  document.getElementById('confirmOk').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
  });
  document.getElementById('confirmCancel').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
      if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
    }
  });
}

function showConfirm(title, detailsHtml) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmDetails').innerHTML = detailsHtml || '';
    document.getElementById('confirmOverlay').classList.add('open');
  });
}

document.addEventListener('DOMContentLoaded', initConfirmModal);
