// Small UI services shared by screens: toasts, sheets, confirm dialogs, busy buttons, forms.
import { html, render, SafeHtml } from './html.js';
import { icon } from './icons.js';

/**
 * Shows a short message above the tab bar.
 * @param {string} message
 * @param {{ tone?: 'default'|'danger', action?: { label: string, onClick: () => void }, timeout?: number }} [opts]
 */
export function toast(message, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast${opts.tone === 'danger' ? ' toast-danger' : ''}`;
  el.setAttribute('role', opts.tone === 'danger' ? 'alert' : 'status');
  render(
    el,
    html`<span class="grow">${message}</span>${opts.action ? html`<button type="button">${opts.action.label}</button>` : ''}`,
  );
  const remove = () => {
    el.remove();
  };
  if (opts.action) {
    el.querySelector('button').addEventListener('click', () => {
      remove();
      opts.action.onClick();
    });
  }
  host.append(el);
  setTimeout(remove, opts.timeout ?? (opts.action ? 6000 : 3200));
}

/**
 * Opens a bottom sheet (centred dialog on wide screens). Focus is trapped by <dialog>.
 * @param {{ title: string, body: SafeHtml, onMount?: (el: HTMLElement, close: (value?: any) => void) => (void|(() => void)),
 *   wide?: boolean }} opts
 * @returns {Promise<any>} resolves with the value passed to close()
 */
export function openSheet(opts) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
    dialog.setAttribute('aria-labelledby', titleId);
    render(
      dialog,
      html`<div class="sheet-head">
          <h2 id="${titleId}">${opts.title}</h2>
          <button type="button" class="icon-btn" data-sheet-close aria-label="Close">${icon('x')}</button>
        </div>
        <div class="sheet-body">${opts.body}</div>`,
    );
    document.body.append(dialog);
    let result;
    let cleanup = null;
    const close = (value) => {
      result = value;
      dialog.close();
    };
    // A sheet belongs to the screen that opened it: leaving that screen (Back, a link) dismisses
    // it, so it can't act on a page the person has left. A sheet already closing keeps its result.
    const onRouteChange = () => {
      if (dialog.open) close(undefined);
    };
    window.addEventListener('hashchange', onRouteChange);
    dialog.addEventListener('close', () => {
      window.removeEventListener('hashchange', onRouteChange);
      if (typeof cleanup === 'function') cleanup();
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(undefined); // backdrop tap
      if (event.target instanceof Element && event.target.closest('[data-sheet-close]')) close(undefined);
    });
    dialog.showModal();
    cleanup = opts.onMount?.(dialog.querySelector('.sheet-body'), close) ?? null;
  });
}

/**
 * Asks for confirmation. Resolves true when confirmed.
 * @param {{ title: string, message?: string|SafeHtml, confirmLabel: string, cancelLabel?: string, tone?: 'danger'|'default' }} opts
 */
export function confirmDialog(opts) {
  return openSheet({
    title: opts.title,
    body: html`<div class="stack">
      ${opts.message ? html`<p>${opts.message}</p>` : ''}
      <div class="button-row">
        <button type="button" class="btn ${opts.tone === 'danger' ? 'btn-danger' : 'btn-primary'}" data-confirm>${opts.confirmLabel}</button>
        <button type="button" class="btn btn-ghost" data-sheet-close>${opts.cancelLabel ?? 'Cancel'}</button>
      </div>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-confirm]').addEventListener('click', () => close(true));
    },
  }).then((value) => value === true);
}

/**
 * Runs an async action with the button disabled and marked busy, so repeated taps don't
 * submit twice. Returns the action's result, or undefined if the button was already busy.
 */
export async function withBusy(button, action) {
  if (!button) return action();
  if (button.getAttribute('aria-busy') === 'true') return undefined;
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  try {
    return await action();
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

/** Reads a form into a plain object. Repeated names become arrays; checkboxes give booleans
 * when there is a single checkbox of that name. */
export function formData(form) {
  const data = {};
  const fd = new FormData(form);
  for (const [key, value] of fd.entries()) {
    if (key in data) {
      data[key] = Array.isArray(data[key]) ? [...data[key], value] : [data[key], value];
    } else {
      data[key] = value;
    }
  }
  for (const el of form.querySelectorAll('input[type="checkbox"][name]')) {
    const same = form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`);
    if (same.length === 1) data[el.name] = el.checked;
    else if (!(el.name in data)) data[el.name] = [];
  }
  return data;
}

/** Shows field errors from an ApiError('invalid', ..., { fields: { name: message } }). */
export function showFieldErrors(form, error) {
  for (const el of form.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
  for (const el of form.querySelectorAll('.field-error[data-for]')) el.remove();
  const fields = error?.details?.fields ?? {};
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const note = document.createElement('p');
    note.className = 'field-error';
    note.dataset.for = name;
    note.id = `err-${name}`;
    note.textContent = message;
    input.setAttribute('aria-describedby', note.id);
    (input.closest('.field') ?? input.parentElement).append(note);
    first ??= input;
  }
  first?.focus();
  return Boolean(first);
}

/** Shows an error from the API as a toast, using its safe message. */
export function toastError(error, fallback = 'Something went wrong. Try again.') {
  console.error(error);
  toast(error?.message || fallback, { tone: 'danger' });
}

/** Downloads a Blob as a file. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { SafeHtml };
