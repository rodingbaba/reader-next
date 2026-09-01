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
  }
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

export const invokeTTS = (_action: string, _payload?: any) => {
  // 禁用 Native TTS 桥接，让 Web 端全权负责 TTS 播放。
  // Web 端的实现可以完美支持文字高亮、自动翻段、以及 iOS MediaSession 锁屏播放控件。
  return false;
};

export const invokeData = async (action: string, payload?: any): Promise<any> => {
  if (isNativeApp()) {
    const { callbackId, promise } = createCallbackPromise();
    window.webkit!.messageHandlers!.dataControl!.postMessage({ action, payload, callbackId });
    return promise;
  }
  return null;
};

export const invokeSync = (action: string, payload?: any) => {
  if (isNativeApp()) {
    window.webkit!.messageHandlers!.syncControl!.postMessage({ action, payload });
    return true;
  }
  return false;
};
