export function evaluateHttpTtsUrl(template: string, speakText: string, speakSpeed: number): string {
  if (!template) return ''

  return template.replace(/\{\{([\s\S]+?)\}\}/g, (_, exp) => {
    try {
      // Provide a sandboxed environment with speakText, speakSpeed, and a mocked java object
      const fn = new Function('speakText', 'speakSpeed', 'java', `return ${exp}`)

      const java = {
        encodeURI: (s: string) => encodeURIComponent(s)
      }

      const result = fn(speakText, speakSpeed, java)

      if (result === null || result === undefined) {
        return ''
      }
      return String(result)
    } catch (e) {
      console.warn(`Failed to evaluate TTS template expression: {{${exp}}}`, e)
      return ''
    }
  })
}

export interface HttpTtsRequestOptions {
  method: string
  headers?: Record<string, string>
  body?: any
}

export function parseHttpTtsTemplate(template: string): { url: string, options: HttpTtsRequestOptions } {
  // Support Legado's JSON options syntax, e.g. "http://.../tts,{\"method\":\"POST\"}"
  const match = template.match(/^(.*?)(\s*,\s*(\{.*\}))$/)

  if (match) {
    const url = match[1].trim()
    try {
      const optionsJson = JSON.parse(match[3])
      return {
        url,
        options: {
          method: optionsJson.method || 'GET',
          headers: optionsJson.headers,
          body: optionsJson.body
        }
      }
    } catch {
      return { url: template.trim(), options: { method: 'GET' } }
    }
  }

  return { url: template.trim(), options: { method: 'GET' } }
}

export async function requestHttpTtsAudio(
  template: string,
  speakText: string,
  speechRate: number,
  signal?: AbortSignal
): Promise<Blob> {
  // Map standard HTML5 playback rate (0.5 - 4.0) to Legado's standard 0-100 speakSpeed range
  // Legado default is 50 for 1.0x speed.
  const mappedSpeed = Math.max(0, Math.min(100, Math.round(speechRate * 50)))

  const evaluatedTemplate = evaluateHttpTtsUrl(template, speakText, mappedSpeed)
  if (!evaluatedTemplate) {
    throw new Error('HTTP TTS 配置为空或解析失败')
  }

  const { url, options } = parseHttpTtsTemplate(evaluatedTemplate)

  let fetchOptions: RequestInit = {
    method: options.method,
    signal
  }

  if (options.headers) {
    fetchOptions.headers = options.headers
  }

  if (options.body) {
    if (typeof options.body === 'object') {
      fetchOptions.body = JSON.stringify(options.body)
      fetchOptions.headers = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers
      }
    } else {
      fetchOptions.body = String(options.body)
    }
  }

  const response = await fetch(url, fetchOptions)

  if (!response.ok) {
    let errorText = response.statusText
    try {
      const text = await response.text()
      if (text) {
        errorText += ` - ${text.slice(0, 200)}`
      }
    } catch (e) {
      // ignore
    }
    throw new Error(`HTTP TTS 请求失败 (${response.status}): ${errorText}`)
  }

  return response.blob()
}
