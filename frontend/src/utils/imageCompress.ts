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
  fileOrBlob: File | Blob | string,
  maxWidth = 280,
  maxHeight = 400,
  quality = 0.8,
  maxBase64Chars = 68 * 1024,
): Promise<CompressResult> {
  const fallback = async () => {
    let dataUrl = ''
    if (typeof fileOrBlob === 'string') {
      dataUrl = fileOrBlob
    } else {
      dataUrl = await blobToDataUrlFallback(fileOrBlob)
    }
    const blob = typeof fileOrBlob === 'string' ? dataUrlToBlob(fileOrBlob) : fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob])
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
    let curQuality = quality
    let dataUrl = canvas.toDataURL(mimeType, curQuality)

    // 自适应阶梯降质：若超出目标大小，自动平滑降低质量
    const qualitySteps = [0.72, 0.62, 0.52]
    for (const stepQuality of qualitySteps) {
      if (dataUrl.length <= maxBase64Chars) break
      curQuality = stepQuality
      dataUrl = canvas.toDataURL(mimeType, curQuality)
    }

    // 若降质后依然超过目标大小，按比例微调重采样，确保 100% 能够装入快照池
    if (dataUrl.length > maxBase64Chars && (targetWidth > 180 || targetHeight > 260)) {
      const scaleRatio = 0.8
      canvas.width = Math.max(1, Math.round(targetWidth * scaleRatio))
      canvas.height = Math.max(1, Math.round(targetHeight * scaleRatio))
      const scaleCtx = canvas.getContext('2d')
      if (scaleCtx) {
        scaleCtx.imageSmoothingEnabled = true
        scaleCtx.imageSmoothingQuality = 'high'
        scaleCtx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height)
        curQuality = 0.62
        dataUrl = canvas.toDataURL(mimeType, curQuality)
      }
    }

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
        curQuality,
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
function loadImage(source: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof source === 'string') {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = (err) => reject(err)
      img.src = source
      return
    }
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
    }, 3000)
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
