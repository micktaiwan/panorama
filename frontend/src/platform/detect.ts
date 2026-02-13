/**
 * Platform detection — desktop (Tauri) vs web
 */

let _isTauri: boolean | null = null;

export function isTauri(): boolean {
  if (_isTauri === null) {
    _isTauri = !!(window as any).__TAURI_INTERNALS__;
  }
  return _isTauri;
}
