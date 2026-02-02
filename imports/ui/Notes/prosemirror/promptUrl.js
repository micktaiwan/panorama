/**
 * Imperative URL prompt using a DOM modal (no window.prompt).
 * Reuses the app's modal CSS classes for visual consistency.
 * Returns a Promise that resolves to the entered URL or null if cancelled.
 */
export function promptUrl(defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modalOverlay';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'modalBackdrop';
    backdrop.setAttribute('aria-label', 'Close modal');

    const panel = document.createElement('dialog');
    panel.className = 'modalPanel';
    panel.setAttribute('open', '');
    panel.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'modalHeader';
    const title = document.createElement('div');
    title.className = 'modalTitle';
    title.textContent = 'Enter URL';
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'modalBody';
    const input = document.createElement('input');
    input.type = 'url';
    input.value = defaultValue;
    input.placeholder = 'https://...';
    input.style.cssText = 'width:100%;padding:8px;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-deep);color:inherit;font-size:14px;outline:none;';
    body.appendChild(input);

    const footer = document.createElement('div');
    footer.className = 'modalFooter';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn ghost';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary';
    okBtn.textContent = 'OK';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(backdrop);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    function cleanup(value) {
      overlay.remove();
      resolve(value);
    }

    cancelBtn.onclick = () => cleanup(null);
    backdrop.onclick = () => cleanup(null);
    okBtn.onclick = () => cleanup(input.value || null);

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') cleanup(input.value || null);
      if (e.key === 'Escape') cleanup(null);
    });

    requestAnimationFrame(() => input.focus());
  });
}
