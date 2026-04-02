const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export const api = {
  // Projects
  listProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  // Crawl
  startCrawl: (id) => request(`/projects/${id}/crawl`, { method: 'POST' }),
  crawlStatus: (id) => request(`/projects/${id}/crawl/status`),

  // Analysis
  startAnalysis: (id) => request(`/projects/${id}/analyze`, { method: 'POST' }),
  getResults: (id) => request(`/projects/${id}/results`),
  getDashboard: (id) => request(`/projects/${id}/dashboard`),

  // GSC
  getGscAuthUrl: (id) => request(`/gsc/auth-url?project_id=${id}`),
  fetchGscData: (id, startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return request(`/projects/${id}/gsc/fetch?${params}`, { method: 'POST' });
  },
  uploadGscCsv: async (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/projects/${id}/gsc/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  getGscData: (id) => request(`/projects/${id}/gsc/data`),
};
