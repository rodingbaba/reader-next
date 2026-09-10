export interface NativeBridgeMessage {
  action: string;
  payload?: any;
  callbackId?: string;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        ttsControl?: { postMessage: (msg: NativeBridgeMessage) => void };
        dataControl?: { postMessage: (msg: NativeBridgeMessage) => void };
        syncControl?: { postMessage: (msg: NativeBridgeMessage) => void };
      }
    };
    __nativeBridgeCallbacks?: Record<string, { resolve: (data: any) => void; reject: (err: any) => void }>;
    __nativeBridgeCallback?: (id: string, data: any, error?: any) => void;
    __nativeInitialOnline?: boolean;
    __nativeOnlineStatus?: boolean;
    __onNativeNetworkChange?: (isOnline: boolean) => void;
  }
}

// 自动挂载原生网络变化回调，将原生网络事件广播为标准 Web 事件
if (typeof window !== 'undefined') {
  if (typeof window.__nativeInitialOnline === 'boolean') {
    window.__nativeOnlineStatus = window.__nativeInitialOnline;
  }
  window.__onNativeNetworkChange = (isOnline: boolean) => {
    window.__nativeOnlineStatus = isOnline;
    window.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));
    window.dispatchEvent(new CustomEvent('native-network-change', { detail: { isOnline } }));
  };
}

/**
 * 获取当前最可靠的网络连通状态：
 * 优先取原生 Bridge 毫秒级探测结果；非原生环境平滑降级使用 navigator.onLine
 */
export function isNetworkOnline(): boolean {
  if (typeof window !== 'undefined') {
    if (typeof window.__nativeOnlineStatus === 'boolean') {
      return window.__nativeOnlineStatus;
    }
    if (typeof window.__nativeInitialOnline === 'boolean') {
      return window.__nativeInitialOnline;
    }
  }
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

let callbackIdCounter = 0;

function createCallbackPromise(): { callbackId: string; promise: Promise<any> } {
  const id = `cb_${++callbackIdCounter}_${Date.now()}`;
  if (!window.__nativeBridgeCallbacks) {
    window.__nativeBridgeCallbacks = {};
    window.__nativeBridgeCallback = (callbackId, data, error) => {
      const cb = window.__nativeBridgeCallbacks![callbackId];
      if (cb) {
        if (error) cb.reject(error);
        else cb.resolve(data);
        delete window.__nativeBridgeCallbacks![callbackId];
      }
    };
  }

  const promise = new Promise((resolve, reject) => {
    window.__nativeBridgeCallbacks![id] = { resolve, reject };
  });

  return { callbackId: id, promise };
}

export const isNativeApp = () => {
  return !!(window.webkit?.messageHandlers?.dataControl);
};

export const invokeData = (action: string, payload?: any) => {
  if (isNativeApp()) {
    const { callbackId, promise } = createCallbackPromise();
    const cleanPayload = payload ? JSON.parse(JSON.stringify(payload)) : payload;
    window.webkit!.messageHandlers!.dataControl!.postMessage({ action, payload: cleanPayload, callbackId });
    return promise;
  }
  return Promise.reject(new Error('Not in native app environment'));
};

export const invokeTTS = (action: string, payload?: any) => {
  if (isNativeApp() && window.webkit?.messageHandlers?.ttsControl) {
    const cleanPayload = payload ? JSON.parse(JSON.stringify(payload)) : payload;
    window.webkit.messageHandlers.ttsControl.postMessage({ action, payload: cleanPayload });
    return true;
  }
  return false;
};

export const invokeSync = (action: string, payload?: any) => {
  if (isNativeApp()) {
    const cleanPayload = payload ? JSON.parse(JSON.stringify(payload)) : payload;
    window.webkit!.messageHandlers!.syncControl!.postMessage({ action, payload: cleanPayload });
    return true;
  }
  return false;
};
