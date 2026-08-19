import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PlannerDatabase } from './database'
import {
  validateArgumentCount,
  validateClipboardText,
  validateConceptFolderInput,
  validateConceptLinkInput,
  validateConceptNodeInput,
  validateContentTypeTemplateInput,
  validateId,
  validateIdeaInput,
  validateEnrichedInput,
  validateExportProfileInput,
  validateMediaMode,
  validateNoArguments,
  validateOptionalPostStatus,
  validatePostInput,
  validateProject,
  validateSourceDefinitionInput,
  validateSourceInput,
} from './ipc-validation'
import { UpdateManager } from './updater'
import { parsePayload } from './integrations/parser'
import { reconcile } from './integrations/reconciler'
import { suggestSourceMapping } from './integrations/suggestions'
import { hashExportRecord, toCsv, type ExportColumn } from './integrations/exporter'
import type { SourceDefinitionConfig } from './integrations/types'

let mainWindow: BrowserWindow | null = null
let database: PlannerDatabase
let updater: UpdateManager
const pendingImports = new Map<string, { sourceId: string; items: Record<string, unknown>[] }>()
const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
const rendererFilePath = path.join(__dirname, '../dist/index.html')
const rendererFileUrl = pathToFileURL(rendererFilePath).href
const mediaScheme = 'caballocci-media'

protocol.registerSchemesAsPrivileged([{
  scheme: mediaScheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

function isTrustedRendererUrl(candidate: string) {
  try {
    const actual = new URL(candidate)
    actual.hash = ''
    actual.search = ''
    if (devServerUrl) {
      const expected = new URL(devServerUrl)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }
    return actual.href === rendererFileUrl
  } catch {
    return false
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const window = mainWindow
  const frame = event.senderFrame
  if (
    !window || window.isDestroyed() || !frame ||
    event.sender !== window.webContents ||
    frame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(frame.url)
  ) {
    throw new Error('Solicitud IPC rechazada')
  }
}

function handle(channel: string, callback: (args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event)
    return callback(args)
  })
}

function withoutArguments(callback: () => unknown) {
  return (args: unknown[]) => {
    validateNoArguments(args)
    return callback()
  }
}

function mapMediaAssets(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map(item => {
        const asset = item as Record<string, unknown>
        return { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, mode: asset.mode }
      })
  } catch {
    return []
  }
}

function mapIdeaBlocks(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map(item => {
        const block = item as Record<string, unknown>
        return { id: block.id, title: block.title, text: block.text }
      })
  } catch {
    return []
  }
}

function mapPost(row: Record<string, unknown>) {
  return {
    id: row.id, title: row.title, caption: row.caption, notes: row.notes,
    hashtags: JSON.parse(String(row.hashtags || '[]')), mentions: JSON.parse(String(row.mentions || '[]')),
    platforms: JSON.parse(String(row.platforms || '[]')), contentType: row.content_type, status: row.status,
    scheduledAt: row.scheduled_at, durationMinutes: row.duration_minutes, project: row.project, color: row.color,
    media: mapMediaAssets(row.media), ideaBlocks: mapIdeaBlocks(row.idea_blocks), sourceIdeaId: row.source_idea_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapIdea(row: Record<string, unknown>) {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(String(row.tags || '[]')) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = []
  }
  return {
    id: row.id, space: row.space, title: row.title, body: row.body, tags,
    media: mapMediaAssets(row.media), status: row.status, priority: row.priority,
    dueDate: row.due_at || null, postId: row.post_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function mapSource(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, baseUrl: row.base_url, method: row.method, format: row.format,
    recordsPath: row.records_path || null, bodyTemplate: row.body_template || null, authType: row.auth_type,
    maxRecords: row.max_records, targetProject: row.target_project || 'Mi contenido', importMode: row.import_mode || 'post', initialStatus: row.initial_status || 'idea', createdAt: row.created_at, updatedAt: row.updated_at,
    hasStoredCredentials: Boolean(row.headers_ciphertext || row.auth_ciphertext),
    hasStoredHeaders: Boolean(row.headers_ciphertext),
    hasStoredAuth: Boolean(row.auth_ciphertext),
  }
}

function mapSourceDefinition(row: Record<string, unknown>) {
  return {
    id: row.id, sourceId: row.source_id, fieldMap: jsonObject(row.field_map_json),
    contentTypeMap: jsonObject(row.content_type_map_json), customFieldDefaults: jsonObject(row.custom_field_defaults_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapContentRecord(row: Record<string, unknown>) {
  return {
    id: row.id, postId: row.post_id || null, ideaId: row.idea_id || null, sourceId: row.source_id, externalRef: row.external_ref,
    sourceKind: row.source_kind, contentHash: row.content_hash, raw: jsonObject(row.raw_json),
    normalized: jsonObject(row.normalized_json), enriched: jsonObject(row.enriched_json), suggestedTitle: row.suggested_title || null,
    titleManuallyEdited: Number(row.title_manually_edited) === 1, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, lastSeenAt: row.last_seen_at,
  }
}

function mapContentTypeTemplate(row: Record<string, unknown>) {
  let fields: unknown[] = []
  try { const parsed = JSON.parse(String(row.fields_json || '[]')) as unknown; if (Array.isArray(parsed)) fields = parsed } catch { /* Invalid rows are treated as empty. */ }
  return { id: row.id, contentType: row.content_type, fields, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapExportProfile(row: Record<string, unknown>) {
  let columns: unknown[] = []
  try { const parsed = JSON.parse(String(row.columns_json || '[]')) as unknown; if (Array.isArray(parsed)) columns = parsed } catch { /* Invalid rows are treated as empty. */ }
  return { id: row.id, name: row.name, appliesToContentType: row.applies_to_content_type, columns, createdAt: row.created_at, updatedAt: row.updated_at }
}

function exportRecord(row: Record<string, unknown>, mediaAssets: Record<string, unknown>[]) {
  const parseArray = (value: unknown): unknown[] => { try { const parsed = JSON.parse(String(value || '[]')) as unknown; return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
  const project = String(row.post_project || '')
  const media = parseArray(row.post_media)
  const mediaIds = media.map(item => typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).id || '') : String(item))
  const groupedIdeas = parseArray(row.post_idea_blocks).map((value, index) => {
    const idea = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    const text = String(idea.text || '')
    return { order: index, id: String(idea.id || ''), title: String(idea.title || ''), text, body: text }
  })
  return {
    id: row.content_id || row.post_id || row.id, externalRef: row.external_ref || '', sourceKind: row.source_kind || '',
    raw: jsonObject(row.raw_json), enriched: jsonObject(row.enriched_json), normalized: jsonObject(row.normalized_json),
    planning: { status: row.post_status || 'idea', date: row.post_scheduled_at || null, format: row.post_content_type || null, project },
    post: { title: row.post_title || '', caption: row.post_caption || '', notes: row.post_notes || '', hashtags: parseArray(row.post_hashtags), mentions: parseArray(row.post_mentions), platforms: parseArray(row.post_platforms), media, mediaAssets: mediaAssets.filter(asset => mediaIds.includes(String(asset.id))), contentType: row.post_content_type || null },
    ideas: groupedIdeas,
  }
}

function encryptSecret(value: Record<string, string>): string {
  if (Object.keys(value).length === 0) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no está disponible')
  return safeStorage.encryptString(JSON.stringify(value)).toString('base64')
}

function decryptSecret(value: unknown): Record<string, string> {
  if (!value) return {}
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no está disponible')
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(String(value), 'base64'))) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch { throw new Error('No se pudieron descifrar las credenciales de la fuente') }
}

type FetchSourceResult = { payload: string; status: number; statusText: string; contentType: string; requestDetails: string }

function formatRequestDetails(url: URL, method: string, headers: Record<string, string>, body: string | undefined) {
  const headerLines = Object.entries(headers).map(([key, value]) => {
    const sensitive = /authorization|token|secret|api[-_]?key|password/i.test(key)
    return `  ${key}: ${sensitive ? `<redacted; ${value.length} chars>` : value}`
  })
  const bodyLine = body ? `Body JSON: configurado (${body.length} caracteres)` : 'Body: ninguno'
  return [`${method} ${url.href}`, 'Headers:', ...(headerLines.length ? headerLines : ['  (ninguno)']), bodyLine].join('\n')
}

async function fetchSource(source: Record<string, unknown>): Promise<FetchSourceResult> {
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

function mapConceptNode(row: Record<string, unknown>) {
  return {
    id: row.id, folderId: row.folder_id || null, kind: row.kind, sourceId: row.source_id || null,
    title: row.title, body: row.body, x: row.x, y: row.y,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapConceptFolder(row: Record<string, unknown>) {
  return { id: row.id, parentId: row.parent_id || null, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapConceptLink(row: Record<string, unknown>) {
  return {
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id,
    relation: row.relation, createdAt: row.created_at,
  }
}

function registerMediaProtocol() {
  protocol.handle(mediaScheme, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response(null, { status: 404 })
      const id = validateId(decodeURIComponent(url.pathname.slice(1)), 'media.id')
      const media = database.getMediaFile(id)
      if (!media || media.kind !== 'image' || !path.isAbsolute(media.path) || !fs.existsSync(media.path)) {
        return new Response(null, { status: 404 })
      }
      return net.fetch(pathToFileURL(media.path).href, { bypassCustomProtocolHandlers: true })
    } catch {
      return new Response(null, { status: 400 })
    }
  })
}

async function createWindow() {
  const windowIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1120, minHeight: 720, show: false,
    icon: windowIcon,
    backgroundColor: '#101311', titleBarStyle: 'hidden', titleBarOverlay: { color: '#101311', symbolColor: '#c9d0ca', height: 64 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preventUntrustedNavigation = (event: Electron.Event, targetUrl: string) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault()
  }
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation)
  mainWindow.webContents.on('will-redirect', preventUntrustedNavigation)
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())

  if (devServerUrl) await mainWindow.loadURL(devServerUrl)
  else await mainWindow.loadFile(rendererFilePath)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
}

app.setAppUserModelId('com.caballocci.desktop')

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

app.whenReady().then(async () => {
  const wasmPath = app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')
  const dataDirectory = app.getPath('userData')
  const databasePath = path.join(dataDirectory, 'caballocci.sqlite')
  const backupsDirectory = path.join(dataDirectory, 'Backups')
  const appDataDirectory = app.getPath('appData')
  const legacyDatabasePaths = [
    path.join(dataDirectory, 'content-planner.sqlite'),
    path.join(appDataDirectory, 'Content Planner', 'content-planner.sqlite'),
    path.join(appDataDirectory, 'content-planner', 'content-planner.sqlite'),
    path.join(appDataDirectory, 'Electron', 'content-planner.sqlite'),
  ]
  const legacyDatabasePath = legacyDatabasePaths.find(candidate => fs.existsSync(candidate))
  if (!fs.existsSync(databasePath) && legacyDatabasePath) {
    fs.mkdirSync(dataDirectory, { recursive: true })
    fs.copyFileSync(legacyDatabasePath, databasePath)
  }
  database = new PlannerDatabase(databasePath, wasmPath, backupsDirectory)
  await database.init()
  registerMediaProtocol()
  updater = new UpdateManager(() => mainWindow, () => { database.createBackup('before-update') })
  handle('posts:list', withoutArguments(() => database.list().map(mapPost)))
  handle('posts:save', args => {
    validateArgumentCount(args, 1)
    return mapPost(database.save(validatePostInput(args[0])))
  })
  handle('posts:remove', args => {
    validateArgumentCount(args, 1)
    return database.remove(validateId(args[0], 'post.id'))
  })
  handle('posts:reassign-project', args => {
    validateArgumentCount(args, 2)
    return database.reassignProject(validateProject(args[0], 'fromProject'), validateProject(args[1], 'toProject'))
  })
  handle('sources:list', withoutArguments(() => database.listSources().map(mapSource)))
  handle('sources:save', args => {
    validateArgumentCount(args, 1)
    const input = validateSourceInput(args[0])
    const current = input.id ? database.getSource(String(input.id)) : undefined
    const source = database.saveSource({
      ...input,
      headersCiphertext: Object.keys(input.headers as Record<string, string>).length > 0 ? encryptSecret(input.headers as Record<string, string>) : current?.headers_ciphertext || '',
      authCiphertext: Object.keys(input.authConfig as Record<string, string>).length > 0 ? encryptSecret(input.authConfig as Record<string, string>) : current?.auth_ciphertext || '',
    })
    return mapSource(source)
  })
  handle('sources:remove', args => {
    validateArgumentCount(args, 1)
    return database.removeSource(validateId(args[0], 'source.id'))
  })
  handle('sources:apply-destination', args => {
    validateArgumentCount(args, 1)
    return database.applySourceDestination(validateId(args[0], 'source.id'))
  })
  handle('source-definitions:list', args => {
    if (args.length > 1) throw new TypeError('Argumento IPC no valido: count')
    const sourceId = args.length === 1 ? validateId(args[0], 'sourceDefinition.sourceId') : undefined
    return database.listSourceDefinitions(sourceId).map(mapSourceDefinition)
  })
  handle('source-definitions:save', args => {
    validateArgumentCount(args, 1)
    const input = validateSourceDefinitionInput(args[0])
    const fieldMap = input.fieldMap as Record<string, unknown>
    return mapSourceDefinition(database.saveSourceDefinition({
      ...input,
      fieldMapJson: JSON.stringify({ ...fieldMap, hashFields: input.hashFields }),
      contentTypeMapJson: JSON.stringify(input.contentTypeMap),
      customFieldDefaultsJson: JSON.stringify(input.customFieldDefaults),
    }))
  })
  handle('sources:test', async args => {
    validateArgumentCount(args, 1)
    const input = validateSourceInput(args[0])
    const current = input.id ? database.getSource(String(input.id)) : undefined
    const headers = input.headers as Record<string, string>
    const authConfig = input.authConfig as Record<string, string>
    const source = {
      ...input,
      base_url: input.baseUrl,
      body_template: input.bodyTemplate,
      headers_ciphertext: Object.keys(headers).length > 0 ? encryptSecret(headers) : current?.headers_ciphertext || '',
      auth_ciphertext: Object.keys(authConfig).length > 0 ? encryptSecret(authConfig) : current?.auth_ciphertext || '',
    }
    const result = await fetchSource(source)
    let records: Record<string, unknown>[] = []; let parseWarning = ''
    try {
      records = parsePayload(result.payload, String(input.format) as 'json' | 'ndjson' | 'csv', input.recordsPath ? String(input.recordsPath) : null, Number(input.maxRecords || 500)).records
    } catch (error) { parseWarning = error instanceof Error ? error.message : 'No se pudo interpretar la respuesta' }
    return { ok: true, bytes: result.payload.length, status: result.status, statusText: result.statusText, contentType: result.contentType, sample: result.payload.slice(0, 1200), requestDetails: result.requestDetails, recordCount: records.length, fields: records[0] ? Object.keys(records[0]) : [], suggestion: suggestSourceMapping(records), parseWarning }
  })
  handle('imports:preview', async args => {
    validateArgumentCount(args, 2)
    const sourceId = validateId(args[0], 'source.id'); const definitionId = validateId(args[1], 'sourceDefinition.id')
    const source = database.getSource(sourceId); const definition = database.getSourceDefinition(definitionId)
    if (!source || !definition || String(definition.source_id) !== sourceId) throw new Error('Fuente o mapeo no encontrado')
    const response = await fetchSource(source)
    const parsed = parsePayload(response.payload, String(source.format) as 'json' | 'ndjson' | 'csv', source.records_path ? String(source.records_path) : null, Number(source.max_records || 500))
    const fieldMap = jsonObject(definition.field_map_json)
    const config: SourceDefinitionConfig = {
      externalRef: String(fieldMap.externalRef || ''), title: String(fieldMap.title || ''), sourceKindField: String(fieldMap.sourceKindField || ''),
      hashFields: Array.isArray(fieldMap.hashFields) ? fieldMap.hashFields.filter((item): item is string => typeof item === 'string') : [],
      contentTypeMap: jsonObject(definition.content_type_map_json) as Record<string, string>, customFieldDefaults: jsonObject(definition.custom_field_defaults_json),
    }
    const report = reconcile(parsed.records, database.listContentRecords(sourceId).map(row => ({
      id: String(row.id), externalRef: String(row.external_ref), contentHash: String(row.content_hash), raw: jsonObject(row.raw_json), enriched: jsonObject(row.enriched_json), titleManuallyEdited: Number(row.title_manually_edited) === 1, lastSeenAt: String(row.last_seen_at),
    })), config)
    const previewId = crypto.randomUUID(); pendingImports.set(previewId, { sourceId, items: report.items as unknown as Record<string, unknown>[] })
    return { previewId, truncated: parsed.truncated, records: parsed.records.slice(0, 25), report }
  })
  handle('imports:confirm', args => {
    validateArgumentCount(args, 1); const previewId = validateId(args[0], 'import.previewId')
    const pending = pendingImports.get(previewId); if (!pending) throw new Error('Preview de importación expirado')
    pendingImports.delete(previewId)
    return database.applyImport(pending.sourceId, pending.items)
  })
  handle('content-records:list', args => {
    if (args.length > 1) throw new TypeError('Argumento IPC no valido: count')
    const sourceId = args.length === 1 ? validateId(args[0], 'contentRecord.sourceId') : undefined
    return database.listContentRecords(sourceId).map(mapContentRecord)
  })
  handle('content-records:by-post', args => {
    validateArgumentCount(args, 1)
    const record = database.getContentRecordForPost(validateId(args[0], 'post.id'))
    return record ? mapContentRecord(record) : null
  })
  handle('content-records:save-enriched', args => {
    validateArgumentCount(args, 1)
    const input = validateEnrichedInput(args[0])
    return mapContentRecord(database.saveContentEnriched(String(input.id), JSON.stringify(input.enriched)))
  })
  handle('content-type-templates:list', withoutArguments(() => database.listContentTypeTemplates().map(mapContentTypeTemplate)))
  handle('content-type-templates:save', args => {
    validateArgumentCount(args, 1)
    const input = validateContentTypeTemplateInput(args[0])
    return mapContentTypeTemplate(database.saveContentTypeTemplate({ ...input, fieldsJson: JSON.stringify(input.fields) }))
  })
  handle('export-profiles:list', withoutArguments(() => database.listExportProfiles().map(mapExportProfile)))
  handle('export-profiles:save', args => {
    validateArgumentCount(args, 1)
    const input = validateExportProfileInput(args[0])
    return mapExportProfile(database.saveExportProfile({ ...input, columnsJson: JSON.stringify(input.columns) }))
  })
  handle('exports:csv', args => {
    if (args.length < 2 || args.length > 5) throw new TypeError('Argumento IPC no valido: exports.csv')
    const sourceId = args[0] === null ? undefined : validateId(args[0], 'export.sourceId')
    const profileId = validateId(args[1], 'export.profileId'); const profile = database.getExportProfile(profileId)
    if (!profile) throw new Error('Perfil de exportacion no encontrado')
    let columns: ExportColumn[] = []
    try { const parsed = JSON.parse(String(profile.columns_json)) as unknown; if (Array.isArray(parsed)) columns = parsed as ExportColumn[] } catch { /* The profile is invalid. */ }
    if (columns.length === 0) throw new Error('El perfil no tiene columnas')
    const deltaOnly = args[2] === undefined ? true : args[2] === true
    const project = args[3] === undefined || args[3] === null || args[3] === '' ? undefined : String(args[3])
    const status = validateOptionalPostStatus(args[4], 'export.status')
    const mediaAssets = database.listMedia()
    const allRecords = database.listExportRows(sourceId, project).map(row => exportRecord(row, mediaAssets)).filter(record => (profile.applies_to_content_type === 'all' || record.planning.format === profile.applies_to_content_type) && (!status || record.planning.status === status))
    const fingerprints = allRecords.map(record => ({ record, rowKey: String(record.id), rowHash: hashExportRecord(record, columns) }))
    const scope = `${project || ''}|${status || ''}`
    const previous = new Map(database.listLastExportSnapshot(profileId, sourceId, scope).map(row => [String(row.row_key), String(row.row_hash)]))
    const records = deltaOnly ? fingerprints.filter(item => previous.get(item.rowKey) !== item.rowHash).map(item => item.record) : allRecords
    database.saveExportSnapshot(profileId, sourceId, scope, deltaOnly ? 'delta' : 'full', fingerprints.map(item => ({ rowKey: item.rowKey, rowHash: item.rowHash })))
    const suffix = deltaOnly ? '-delta' : '-full'
    return { filename: `${String(profile.name).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'export'}${suffix}.csv`, csv: toCsv(records, columns), count: records.length, total: allRecords.length, delta: deltaOnly }
  })
  handle('ideas:list', withoutArguments(() => database.listIdeas().map(mapIdea)))
  handle('ideas:save', args => {
    validateArgumentCount(args, 1)
    return mapIdea(database.saveIdea(validateIdeaInput(args[0])))
  })
  handle('ideas:remove', args => {
    validateArgumentCount(args, 1)
    return database.removeIdea(validateId(args[0], 'idea.id'))
  })
  handle('ideas:convert', args => {
    validateArgumentCount(args, 1)
    const converted = database.convertIdea(validateId(args[0], 'idea.id'))
    return { idea: mapIdea(converted.idea), post: mapPost(converted.post) }
  })
  handle('concept-map:list', withoutArguments(() => {
    const conceptMap = database.listConceptMap()
    return { nodes: conceptMap.nodes.map(mapConceptNode), links: conceptMap.links.map(mapConceptLink), folders: conceptMap.folders.map(mapConceptFolder) }
  }))
  handle('concept-map:save-node', args => {
    validateArgumentCount(args, 1)
    return mapConceptNode(database.saveConceptNode(validateConceptNodeInput(args[0])))
  })
  handle('concept-map:remove-node', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptNode(validateId(args[0], 'conceptMap.node.id'))
  })
  handle('concept-map:save-link', args => {
    validateArgumentCount(args, 1)
    return mapConceptLink(database.saveConceptLink(validateConceptLinkInput(args[0])))
  })
  handle('concept-map:remove-link', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptLink(validateId(args[0], 'conceptMap.link.id'))
  })
  handle('concept-map:save-folder', args => {
    validateArgumentCount(args, 1)
    return mapConceptFolder(database.saveConceptFolder(validateConceptFolderInput(args[0])))
  })
  handle('concept-map:remove-folder', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptFolder(validateId(args[0], 'conceptMap.folder.id'))
  })
  handle('clipboard:write', args => {
    validateArgumentCount(args, 1)
    clipboard.writeText(validateClipboardText(args[0]))
  })
  handle('system:info', withoutArguments(() => ({
    version: app.getVersion(),
    workspacePath: dataDirectory,
    backupsPath: backupsDirectory,
    packaged: app.isPackaged,
  })))
  handle('system:open-workspace', withoutArguments(() => shell.openPath(dataDirectory)))
  handle('system:open-backups', withoutArguments(() => { fs.mkdirSync(backupsDirectory, { recursive: true }); return shell.openPath(backupsDirectory) }))
  handle('system:create-backup', withoutArguments(() => database.createBackup('manual')))
  handle('updates:get-state', withoutArguments(() => updater.getState()))
  handle('updates:check', withoutArguments(() => updater.check()))
  handle('updates:download', withoutArguments(() => updater.download()))
  handle('updates:install', withoutArguments(() => updater.install()))
  handle('media:reveal', args => {
    validateArgumentCount(args, 1)
    const target = database.getMediaPath(validateId(args[0], 'media.id'))
    if (!target || !path.isAbsolute(target)) throw new Error('Archivo multimedia no encontrado')
    shell.showItemInFolder(target)
  })
  handle('media:list', withoutArguments(() => database.listMedia()))
  handle('media:choose', async args => {
    validateArgumentCount(args, 1)
    const mode = validateMediaMode(args[0])
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile','multiSelections'], filters: [{ name:'Contenido', extensions:['png','jpg','jpeg','webp','gif','mp4','mov','pdf','doc','docx'] }] })
    if (result.canceled) return []
    const library = path.join(app.getPath('userData'), 'Media')
    if (mode === 'copy') fs.mkdirSync(library, { recursive: true })
    const assets = result.filePaths.map((source) => {
      let finalPath = source
      if (mode === 'copy') {
        const ext = path.extname(source); const name = `${path.basename(source, ext)}-${crypto.randomUUID()}${ext}`; finalPath = path.join(library, name); fs.copyFileSync(source, finalPath, fs.constants.COPYFILE_EXCL)
      }
      const stat = fs.statSync(finalPath); const ext = path.extname(finalPath).toLowerCase()
      return { id: crypto.randomUUID(), name:path.basename(finalPath), path:finalPath, size:stat.size, mode, kind:['.mp4','.mov'].includes(ext)?'video':['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)?'image':'document' }
    })
    database.saveMedia(assets)
    return assets.map(asset => ({ id: asset.id, name: asset.name, size: asset.size, mode: asset.mode, kind: asset.kind }))
  })
  await createWindow()
  updater.startAutomaticChecks()
})
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
