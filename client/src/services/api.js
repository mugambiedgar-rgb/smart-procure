// REST client. Every call goes to the Express API through /api (proxied by Vite in development).
const BASE = '/api';
const TOKEN_KEY = 'sp_token';

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } };

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

async function request(method, path, body, { blob = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Check that the API is running.', 0);
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* not json */ }
    if (res.status === 401 && token && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(data.message || `Request failed (${res.status})`, res.status, data);
  }
  if (blob) return res.blob();
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  /** Authenticated file download (PDF / CSV / XLSX) */
  async download(path, filename) {
    const blob = await request('GET', path, undefined, { blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  /** Open an authenticated PDF in a new tab (printable documents) */
  async openPdf(path) {
    const blob = await request('GET', path, undefined, { blob: true });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};
