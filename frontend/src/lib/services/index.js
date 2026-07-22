import { api } from '../api';

// ---- Auth ----
export const authApi = {
  me: () => api.get('/auth/me'),
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  refresh: () => api.post('/auth/refresh'),
  updateProfile: (data) => api.patch('/auth/me', data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

// ---- Months ----
export const monthsApi = {
  list: () => api.get('/months'),
  current: () => api.get('/months/current'),
  get: (id) => api.get(`/months/${id}`),
  closingPreview: (id) => api.get(`/months/${id}/closing-preview`),
  close: (id) => api.post(`/months/${id}/close`),
};

// ---- Categories ----
export const categoriesApi = {
  list: (type) => api.get('/categories', { params: { type } }),
  create: (data) => api.post('/categories', data),
  rename: (id, name) => api.patch(`/categories/${id}`, { name }),
  delete: (id) => api.delete(`/categories/${id}`),
  updateLimit: (id, monthlyLimit) => api.patch(`/categories/${id}/limit`, { monthlyLimit }),
  budgets: (monthId) => api.get('/categories/budgets', { params: { monthId } }),
};

// ---- Incomes ----
export const incomesApi = {
  list: (monthId) => api.get('/incomes', { params: { monthId } }),
  create: (data) => api.post('/incomes', data),
  update: (id, data) => api.patch(`/incomes/${id}`, data),
  delete: (id) => api.delete(`/incomes/${id}`),
  deactivateTemplate: (id) => api.patch(`/incomes/templates/${id}/deactivate`),
};

// ---- Expenses ----
export const expensesApi = {
  list: (monthId, type) => api.get('/expenses', { params: { monthId, ...(type ? { type } : {}) } }),
  createVariable: (data) => api.post('/expenses/variable', data),
  createFixed: (data) => api.post('/expenses/fixed', data),
  deactivateFixed: (id) => api.patch(`/expenses/fixed/templates/${id}/deactivate`),
  updateFixedTemplate: (id, data) => api.patch(`/expenses/fixed/templates/${id}`, data),
  deleteFixedTemplate: (id) => api.delete(`/expenses/fixed/templates/${id}`),
  update: (id, data) => api.patch(`/expenses/${id}`, data),
  delete: (id) => api.delete(`/expenses/${id}`),
  pay: (id, data) => api.post(`/expenses/${id}/pay`, data),
};

// ---- Debts ----
export const debtsApi = {
  list: () => api.get('/debts'),
  create: (data) => api.post('/debts', data),
  update: (id, data) => api.patch(`/debts/${id}`, data),
  delete: (id) => api.delete(`/debts/${id}`),
};

// ---- Cards ----
export const cardsApi = {
  list: () => api.get('/cards'),
  create: (data) => api.post('/cards', data),
  update: (id, data) => api.patch(`/cards/${id}`, data),
  deactivate: (id) => api.patch(`/cards/${id}/deactivate`),
  activate: (id) => api.patch(`/cards/${id}/activate`),
  delete: (id) => api.delete(`/cards/${id}`),
  createPurchase: (cardId, data) => api.post(`/cards/${cardId}/purchases`, data),
  listInvoices: (cardId) => api.get(`/cards/${cardId}/invoices`),
  payInvoice: (invoiceId, data) => api.post(`/cards/invoices/${invoiceId}/pay`, data),
};

// ---- Savings ----
export const savingsApi = {
  get: () => api.get('/savings'),
  deposit: (data) => api.post('/savings/deposit', data),
  withdraw: (data) => api.post('/savings/withdraw', data),
  update: (id, data) => api.patch(`/savings/${id}`, data),
  delete: (id) => api.delete(`/savings/${id}`),
};

// ---- Goals ----
export const goalsApi = {
  list: () => api.get('/goals'),
  create: (data) => api.post('/goals', data),
  update: (id, data) => api.patch(`/goals/${id}`, data),
  contribute: (id, data) => api.post(`/goals/${id}/contributions`, data),
  cancel: (id, data) => api.post(`/goals/${id}/cancel`, data),
};

// ---- Dashboard ----
export const dashboardApi = {
  get: (monthId) => api.get('/dashboard', { params: { monthId } }),
};

export const dashboardPreferencesApi = {
  get: () => api.get('/dashboard/preferences'),
  update: (data) => api.patch('/dashboard/preferences', data),
};

// ---- Relatórios Pro ----
export const reportsApi = {
  get: (monthId) => api.get('/reports', { params: { monthId } }),
};

// ---- Financial Health ----
export const financialHealthApi = {
  get: (monthId) => api.get('/financial-health', { params: { monthId } }),
};

// ---- Projections ----
export const projectionsApi = {
  get: (monthId, monthsAhead = 12) => api.get('/projections', { params: { monthId, monthsAhead } }),
};

// ---- Simulators ----
export const simulatorsApi = {
  purchase: (data) => api.post('/simulators/purchase', data),
  whatIfPreview: (data) => api.post('/simulators/what-if/preview', data),
  whatIfSave: (data) => api.post('/simulators/what-if/save', data),
  listSaved: () => api.get('/simulators/what-if'),
  deleteSaved: (id) => api.delete(`/simulators/what-if/${id}`),
};

// ---- Recommendations ----
export const recommendationsApi = {
  get: (monthId) => api.get('/recommendations', { params: { monthId } }),
};

// ---- History ----
export const historyApi = {
  get: (monthId, periods = 6) => api.get('/history', { params: { monthId, periods } }),
};

// ---- Alerts ----
export const alertsApi = {
  list: (monthId) => api.get('/alerts', { params: { monthId } }),
};

// ---- Behavioral Analysis (Tendências) ----
export const behavioralAnalysisApi = {
  get: (monthId, periods = 6) => api.get('/behavioral-analysis', { params: { monthId, periods } }),
};

// ---- Billing / Planos ----
export const billingApi = {
  status: () => api.get('/billing/status'),
  createCheckout: () => api.post('/billing/checkout'),
};

// ---- Calculadoras Pro ----
export const calculatorsApi = {
  run: (calculator, data) => api.post(`/calculators/${calculator}`, data),
};

export const planningApi = {
  get: (monthId) => api.get('/planning', { params: { monthId } }),
};

