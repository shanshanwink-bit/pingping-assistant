const API_BASE = import.meta.env.VITE_API_BASE || '/admin-api/v1'
const TOKEN_KEY = 'pingping_admin_token'

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) || '' },
  set token(value) { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY) },
  clear() { localStorage.removeItem(TOKEN_KEY) }
}

async function request(path, options = {}) {
  const { authToken, skipUnauthorized = false, ...fetchOptions } = options
  const headers = { Accept: 'application/json', ...fetchOptions.headers }
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const token = authToken === undefined ? session.token : authToken
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && !skipUnauthorized) {
      session.clear()
      window.dispatchEvent(new CustomEvent('admin:unauthorized'))
    }
    throw new Error(payload.message || '请求失败，请稍后重试')
  }
  return payload
}

export const api = {
  health: () => request('/health'),
  async login(username, password) {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    session.token = result.token
    return result.user
  },
  me: () => request('/auth/me'),
  logout: token => request('/auth/logout', { method: 'POST', authToken: token, skipUnauthorized: true, keepalive: true }),
  updateProfile: input => request('/auth/profile', { method: 'PATCH', body: JSON.stringify(input) }),
  dashboard: () => request('/dashboard'),
  products: () => request('/products'),
  uploadProductImage(file) {
    const body = new FormData()
    body.append('image', file)
    return request('/product-images', { method: 'POST', body })
  },
  createProduct: input => request('/products', { method: 'POST', body: JSON.stringify(input) }),
  updateProduct: (id, input) => request(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  inventory: () => request('/inventory'),
  salesFinance: () => request('/sales-finance'),
  analysis: filters => request(`/analysis?${new URLSearchParams(filters).toString()}`),
  auditLogs: () => request('/audit-logs'),
  employees: () => request('/employees'),
  createEmployee: input => request('/employees', { method: 'POST', body: JSON.stringify(input) }),
  updateEmployee: (id, input) => request(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}
