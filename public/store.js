// tiny localStorage helpers (JSON, never throw: private mode / full storage just means "not saved")
export const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
export const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
export const drop = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
