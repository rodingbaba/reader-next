import http from './http'

export function getSpeechConfig(): Promise<any> {
  return http.get('/getSpeechConfig').then((r: any) => r.data)
}

export function saveSpeechConfig(config: any): Promise<void> {
  return http.post('/saveSpeechConfig', config).then((r: any) => r.data)
}
