async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body != null ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/me'),
  login: (password) => req('/api/login', { method: 'POST', body: { password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  projects: () => req('/api/projects'),
  createProject: (name) => req('/api/projects', { method: 'POST', body: { name } }),
  deleteProject: (id) => req(`/api/projects/${id}`, { method: 'DELETE' }),
  createEnv: (projectId, name) => req(`/api/projects/${projectId}/environments`, { method: 'POST', body: { name } }),
  secrets: (envId) => req(`/api/environments/${envId}/secrets`),
  setSecret: (envId, key, value) => req(`/api/environments/${envId}/secrets`, { method: 'POST', body: { key, value } }),
  reveal: (envId, key) => req(`/api/environments/${envId}/secrets/${encodeURIComponent(key)}/reveal`),
  history: (envId, key) => req(`/api/environments/${envId}/secrets/${encodeURIComponent(key)}/history`),
  rollback: (envId, key, version) => req(`/api/environments/${envId}/secrets/${encodeURIComponent(key)}/rollback`, { method: 'POST', body: { version } }),
  deleteSecret: (envId, key) => req(`/api/environments/${envId}/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  diff: (projectId, a, b) => req(`/api/projects/${projectId}/diff?a=${a}&b=${b}`),
  tokens: (projectId) => req(`/api/projects/${projectId}/tokens`),
  createToken: (projectId, name, scope) => req(`/api/projects/${projectId}/tokens`, { method: 'POST', body: { name, scope } }),
  deleteToken: (id) => req(`/api/tokens/${id}`, { method: 'DELETE' }),
  audit: () => req('/api/audit')
};
