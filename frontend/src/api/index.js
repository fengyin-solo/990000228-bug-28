import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
})

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('blog_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('blog_token')
      localStorage.removeItem('blog_username')
      // Optionally redirect to login
    }
    return Promise.reject(error)
  }
)

/**
 * Submit several read queries (list / detail / tags) in one request.
 * Every result echoes its `key`, so callers merge by key — never by
 * array position — and one failed query does not fail the others.
 */
export function fetchBatch(queries, config = {}) {
  return api.post('/articles/batch', { queries }, config).then((response) => response.data)
}

export default api
