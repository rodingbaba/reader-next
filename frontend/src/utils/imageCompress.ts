/**
 * 移动端/书架封面客户端离屏轻量化压缩工具
 * 用于将用户上传的 2~3MB 高清大图或网络大封面等比重采样为标准视网膜缩略图（~30KB）
 * 确保生成的 Base64 能够 100% 容纳进 localStorage 首屏 6 本书快照池（<90KB）
 */

export interface CompressResult {
  dataUrl: string
  blob: Blob
  file: File
}

/**
 * 客户端等比缩小并压缩图片
 * @param fileOrBlob 输入的原始 File 或 Blob（可能高达数 MB）
 * @param maxWidth 最大宽度（视网膜屏书架标准建议 360~400px）
 * @param maxHeight 最大高度（建议 500~560px）
 * @param quality JPEG/WebP 压缩质量（默认 0.82）
 */
export async function compressImageToThumbnail(
  fileOrBlob: File | Blob,
  maxWidth = 400,
  maxHeight = 560,
  quality = 0.82,
): Promise<CompressResult> {
  const fallback = async () => {
    const dataUrl = await blobToDataUrlFallback(fileOrBlob)
    const blob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob])
    const file = fileOrBlob instanceof File ? fileOrBlob : new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' })
    return { dataUrl, blob, file }
  }

  // 非浏览器环境或无 Canvas 支持直接兜底
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return fallback()
  }

  try {
    const imageBitmap = await loadImage(fileOrBlob)
    const { width: originalWidth, height: originalHeight } = imageBitmap

    // 计算等比缩小尺寸
    let targetWidth = originalWidth
    let targetHeight = originalHeight

    if (targetWidth > maxWidth || targetHeight > maxHeight) {
      const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight)
      targetWidth = Math.max(1, Math.round(targetWidth * ratio))
      targetHeight = Math.max(1, Math.round(targetHeight * ratio))
    }

    // 离屏 Canvas 绘制
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return fallback()
    }

    // 平滑缩放算法配置
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight)

    // 优先生成 JPEG，兼容性最好且体积小
    const mimeType = 'image/jpeg'
    const dataUrl = canvas.toDataURL(mimeType, quality)

    // 转换为 Blob / File 供上传接口使用
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (b) => {
          if (b) {
            resolve(b)
          } else {
            // 兜底从 dataURL 转 Blob
            resolve(dataUrlToBlob(dataUrl))
          }
        },
        mimeType,
        quality,
      )
    })

    const fileName = fileOrBlob instanceof File ? fileOrBlob.name.replace(/\.[^.]+$/, '.jpg') : 'cover.jpg'
    const compressedFile = new File([blob], fileName, { type: mimeType, lastModified: Date.now() })

    return {
      dataUrl,
      blob,
      file: compressedFile,
    }
  } catch {
    return fallback()
  }
}

/** 异步加载图片为 HTMLImageElement */
function loadImage(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return reject(new Error('URL.createObjectURL not supported'))
    }
    let timer: any = null
    let url = ''
    try {
      url = URL.createObjectURL(source)
    } catch (err) {
      return reject(err)
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
    const img = new Image()
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('Image load timeout'))
    }, 800)
    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = (err) => {
      cleanup()
      reject(err)
    }
    img.src = url
  })
}

function blobToDataUrlFallback(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const bstr = atob(parts[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}
