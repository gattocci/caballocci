import { safeStorage } from 'electron'

type FetchSourceResult = { payload: string; status: number; statusText: string; contentType: string; requestDetails: string }
export function encryptSecret(value: Record<string, string>): string {
  if (Object.keys(value).length === 0) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no está disponible')
  return safeStorage.encryptString(JSON.stringify(value)).toString('base64')
}

export function decryptSecret(value: unknown): Record<string, string> {
  if (!value) return {}
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no está disponible')
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(String(value), 'base64'))) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch { throw new Error('No se pudieron descifrar las credenciales de la fuente') }
}


function formatRequestDetails(url: URL, method: string, headers: Record<string, string>, body: string | undefined) {
  const headerLines = Object.entries(headers).map(([key, value]) => {
    const sensitive = /authorization|token|secret|api[-_]?key|password/i.test(key)
    return `  ${key}: ${sensitive ? `<redacted; ${value.length} chars>` : value}`
  })
  const bodyLine = body ? `Body JSON: configurado (${body.length} caracteres)` : 'Body: ninguno'
  return [`${method} ${url.href}`, 'Headers:', ...(headerLines.length ? headerLines : ['  (ninguno)']), bodyLine].join('\n')
}

export async function fetchSource(source: Record<string, unknown>): Promise<FetchSourceResult> {
  let url: URL
  try { url = new URL(String(source.base_url)) } catch { throw new Error('La URL no es valida. Usa una URL completa, por ejemplo https://dominio.tld/api/catalog.ndjson') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La fuente debe usar HTTP o HTTPS')
  const headers = decryptSecret(source.headers_ciphertext)
  const auth = decryptSecret(source.auth_ciphertext)
  if (source.auth_type === 'apiKey') headers[auth.header || 'X-API-Key'] = auth.value || ''
  if (source.auth_type === 'bearer' && auth.token?.trim()) headers.Authorization = `Bearer ${auth.token}`
  if (source.auth_type === 'basic') headers.Authorization = `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`
  const body = source.method === 'POST' ? String(source.body_template || '') : undefined
  if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
  const requestDetails = formatRequestDetails(url, String(source.method), headers, body)
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, { method: String(source.method), headers, body, signal: controller.signal })
    if (!response.ok) {
      const authHint = response.status === 401 || response.status === 403 ? ' Revisa la autenticacion o el token.' : ''
      throw new Error(`La fuente respondio HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}.${authHint}\nPeticion efectiva:\n${requestDetails}`)
    }
    if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > 25_000_000) throw new Error('La respuesta supera el límite de 25 MB')
    return { payload: text, status: response.status, statusText: response.statusText, contentType: response.headers.get('content-type') || 'desconocido', requestDetails }
  } catch (error) {
    if (error instanceof Error && /HTTP \d+/.test(error.message)) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new Error('La conexion supero el tiempo limite de 30 segundos')
    const reason = error instanceof Error && error.message ? ` Motivo: ${error.message}` : ''
    throw new Error(`No se pudo conectar con ${url.origin}.${reason}\nPeticion efectiva:\n${requestDetails}`)
  } finally { clearTimeout(timeout) }
}

