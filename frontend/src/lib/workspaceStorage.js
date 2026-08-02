const KEY = 'financehub.activeWorkspace.v1';

export function readActiveWorkspaceId() {
  try {
    const value = window.localStorage.getItem(KEY);
    return value && (/^[1-9]\d*$/.test(value) || value === 'real') ? value : 'real';
  } catch {
    return 'real';
  }
}

export function writeActiveWorkspaceId(value) {
  const normalized = value && /^[1-9]\d*$/.test(String(value)) ? String(value) : 'real';
  try { window.localStorage.setItem(KEY, normalized); } catch { /* armazenamento opcional */ }
  return normalized;
}
