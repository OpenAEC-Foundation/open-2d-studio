export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export function isMobileViewer(): boolean {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    // Inside Tauri: use actual platform detection, ignore env vars
    return isAndroid();
  }
  // Browser dev/testing: allow env var override
  if (import.meta.env.VITE_MOBILE_VIEWER === 'true') return true;
  return false;
}
