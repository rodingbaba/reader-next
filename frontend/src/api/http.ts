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

/**
 * 判断是否为网络断开/超时类错误（而非凭证失效）。
 * 网络错误一律不触发 need-login 事件，避免离线时误跳登录面板。
 */
function isNetworkError(error: any): boolean {
  if (!error.response) return true
  if (error.code === 'ERR_NETWORK') return true
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) return true
  return false
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
    // 关键：网络断开/超时一律视为常规网络错误，不触发 need-login
    if (isNetworkError(error)) {
      return Promise.reject(new Error(error.message || '网络连接失败，请检查网络'))
    }

    const data = error.response?.data as Partial<ApiResponse> | undefined
    if (data && typeof data === 'object') {
      // 仅在服务端明确返回 NEED_LOGIN 时触发登录拦截
      if (data.errorMsg === 'NEED_LOGIN' || data.data === 'NEED_LOGIN') {
        dispatchNeedLogin()
      }
      if (typeof data.errorMsg === 'string' && data.errorMsg.trim()) {
        return Promise.reject(new Error(data.errorMsg))
      }
    }
    // HTTP 401：服务端明确凭证失效 → 触发登录拦截
    if (error.response?.status === 401) {
      dispatchNeedLogin()
    }
    return Promise.reject(new Error(error.message || '请求失败'))
  }
)

export default http
