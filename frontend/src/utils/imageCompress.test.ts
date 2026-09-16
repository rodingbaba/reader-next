import { describe, expect, it } from 'vitest'
import { compressImageToThumbnail } from './imageCompress'

describe('imageCompress', () => {
  it('falls back to dataUrl safely in non-DOM/node environments', async () => {
    const rawBlob = new Blob(['fake image data'], { type: 'image/jpeg' })
    const result = await compressImageToThumbnail(rawBlob)

    expect(result.dataUrl).toBeTruthy()
    expect(result.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.file).toBeInstanceOf(File)
  })
})

