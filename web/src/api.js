const BASE = '/api';
const PROFILE_KEY = 'xd.profileId';

/** 当前档案 id（保存在本地，仅作为选择器，不是凭证） */
let profileId = (() => {
  try {
    return localStorage.getItem(PROFILE_KEY) || '';
  } catch {
    return '';
  }
})();

export function setProfileId(id) {
  profileId = id || '';
  try {
    if (profileId) localStorage.setItem(PROFILE_KEY, profileId);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

export function getProfileId() {
  return profileId;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (profileId) headers['X-Profile-Id'] = profileId;

  try {
    res = await fetch(BASE + path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('无法连接本地服务，请确认服务已启动', 0, 'network_error');
  }

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      payload?.error?.message || `请求失败（HTTP ${res.status}）`,
      res.status,
      payload?.error?.code
    );
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

const qs = (o = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  bootstrap: () => request('/bootstrap'),

  listProfiles: () => request('/profiles'),
  probeKey: (apiKey) => request('/profiles/probe', { method: 'POST', body: { apiKey } }),
  createProfile: (payload) => request('/profiles', { method: 'POST', body: payload }),
  updateProfile: (id, payload) =>
    request(`/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  deleteProfile: (id) => request(`/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  meta: () => request('/meta'),
  syncStatus: () => request('/sync/status'),
  triggerSync: (mode = 'quick') => request(`/sync${qs({ mode })}`, { method: 'POST' }),

  shelf: (p) => request(`/shelf${qs(p)}`),
  book: (id) => request(`/books/${encodeURIComponent(id)}`),
  doubanBatch: (items) => request('/douban/batch', { method: 'POST', body: { items } }),

  overview: () => request('/stats/overview'),
  trend: () => request('/stats/trend'),
  profile: () => request('/stats/profile'),

  noteBooks: (p) => request(`/notes/books${qs(p)}`),
  noteBook: (id) => request(`/notes/${encodeURIComponent(id)}`),
  noteSearch: (p) => request(`/notes/search${qs(p)}`),
  exportUrl: (p) => `${BASE}/notes/export${qs(p)}`,

  recommend: (p) => request(`/discover/recommend${qs(p)}`),
  search: (p) => request(`/discover/search${qs(p)}`),
  similar: (p) => request(`/discover/similar${qs(p)}`),
};

export const wereadLink = (bookId) => `weread://reading?bId=${bookId}`;

export const SCOPE_OPTIONS = [
  { value: 10, label: '电子书' },
  { value: 14, label: '有声书' },
  { value: 16, label: '网文' },
  { value: 0, label: '全部' },
  { value: 6, label: '作者' },
  { value: 13, label: '书单' },
];