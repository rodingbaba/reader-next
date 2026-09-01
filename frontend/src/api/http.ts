import axios from 'axios'
import type { ApiResponse } from '../types'
import { buildAuthHeaderValues } from '../utils/secureAccess'
import { isNativeApp } from '../utils/nativeBridge'

let lastNeedLoginDispatchAt = 0

function dispatchNeedLogin() {
  const now = Date.now()
  if (now - lastNeedLoginDispatchAt < 1500) return
  lastNeedLoginDispatchAt = now
  window.dispatchEvent(new CustomEvent('need-login'))
}

function getBaseURL() {
  if (isNativeApp()) {
    return localStorage.getItem('server_base_url') || ''
  }
  return '/reader3'
}

const http = axios.create({
  baseURL: getBaseURL(),
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
})

// ─── Request interceptor: attach token ───
http.interceptors.request.use((config) => {
  // Update baseURL dynamically in case it changed
  if (isNativeApp()) {
    config.baseURL = localStorage.getItem('server_base_url') || ''
  }
  const { accessToken, secureKey } = buildAuthHeaderValues(localStorage)
  if (accessToken) {
    config.headers.Authorization = accessToken
  }
  if (secureKey) {
    config.headers['X-Secure-Key'] = secureKey
  }
  return config
})

// ─── Response interceptor: unwrap ApiResponse ───
http.interceptors.response.use(
  (response) => {
    const data = response.data as ApiResponse
    // Some endpoints return raw data (cover, file etc.)
    if (data.isSuccess === undefined) {
      return response
    }
    if (!data.isSuccess) {
      if (data.errorMsg === 'NEED_LOGIN' || data.data === 'NEED_LOGIN') {
        dispatchNeedLogin()
      }
      return Promise.reject(new Error(data.errorMsg || '请求失败'))
    }
    // Return unwrapped data
    response.data = data.data
    return response
  },
  (error) => {
    const data = error.response?.data as Partial<ApiResponse> | undefined
    if (data && typeof data === 'object') {
      if (data.errorMsg === 'NEED_LOGIN' || data.data === 'NEED_LOGIN') {
        dispatchNeedLogin()
      }
      if (typeof data.errorMsg === 'string' && data.errorMsg.trim()) {
        return Promise.reject(new Error(data.errorMsg))
      }
    }
    if (error.response?.status === 401) {
      dispatchNeedLogin()
    }
    return Promise.reject(new Error(error.message || '请求失败'))
  }
)

export default http
