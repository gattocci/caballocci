import { useEffect, useState } from 'react'
import { Archive, BookOpen, Download, ExternalLink, FolderOpen, Globe2, RefreshCw, RotateCw, Smartphone } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ViewHeading } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import type { MobileExportReport, MobileImportReport, MobileUsageRecord, SystemInfo, UpdateState } from '../../shared/types'
import './about-updates.css'

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const syncthingUiPreferenceKey = 'caballocci.syncthing-ui-url'
const defaultSyncthingUiUrl = 'http://127.0.0.1:8384'

function normalizeSyncthingUiUrl(value: string) {
  const input = value.trim()
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Escribe una URL completa, por ejemplo http://127.0.0.1:8384.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('La dirección debe usar HTTP o HTTPS y no incluir credenciales.')
  }
  return url.href
}

export function AboutUpdates() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [mobileFolder, setMobileFolder] = useState<string | null>(null)
  const [mobileMessage, setMobileMessage] = useState('')
  const [mobileBusy, setMobileBusy] = useState(false)
  const [mobileExportReport, setMobileExportReport] = useState<MobileExportReport | null>(null)
  const [mobileReport, setMobileReport] = useState<MobileImportReport | null>(null)
  const [mobileHistory, setMobileHistory] = useState<MobileUsageRecord[]>([])
  const [syncthingUiUrl, setSyncthingUiUrl] = useState(() => localStorage.getItem(syncthingUiPreferenceKey) || defaultSyncthingUiUrl)
  const [syncthingUiBusy, setSyncthingUiBusy] = useState(false)
  const [syncthingUiMessage, setSyncthingUiMessage] = useState('')
  const [syncthingUiError, setSyncthingUiError] = useState(false)

  useEffect(() => {
    void Promise.all([window.planner.system.info(), window.planner.updates.getState()]).then(([system, state]) => {
      setInfo(system)
      setUpdate(state)
    }).catch(error => reportAppError(error, 'No se pudo cargar la información de la aplicación'))
    void window.planner.mobileSync.folder().then(setMobileFolder).catch(error => reportAppError(error, 'No se pudo consultar la carpeta de sincronización'))
    void window.planner.mobileSync.history().then(setMobileHistory).catch(error => reportAppError(error, 'No se pudo consultar el historial móvil'))
    return window.planner.updates.onStateChange(setUpdate)
  }, [])
  const createBackup = async () => {
    const backupPath = await window.planner.system.createBackup()
    setBackupMessage(`Backup creado: ${backupPath}`)
  }

  const busy = update?.status === 'checking' || update?.status === 'downloading' || update?.status === 'installing'
  const saveSyncthingUiUrl = async (openAfterSave: boolean) => {
    setSyncthingUiBusy(true)
    setSyncthingUiMessage('')
    setSyncthingUiError(false)
    try {
      const normalizedUrl = normalizeSyncthingUiUrl(syncthingUiUrl)
      await window.planner.preferences.sync({ [syncthingUiPreferenceKey]: normalizedUrl })
      localStorage.setItem(syncthingUiPreferenceKey, normalizedUrl)
      setSyncthingUiUrl(normalizedUrl)
      if (openAfterSave) {
        await window.planner.system.openSyncthingUi(normalizedUrl)
        setSyncthingUiMessage('Dirección guardada. Syncthing se abrió en el navegador; comprueba que Syncthing esté ejecutándose en el PC.')
      } else {
        setSyncthingUiMessage('Dirección de Syncthing guardada en este equipo.')
      }
    } catch (error) {
      setSyncthingUiError(true)
      setSyncthingUiMessage(error instanceof Error ? error.message : 'No se pudo guardar o abrir Syncthing.')
      reportAppError(error, 'No se pudo guardar o abrir la interfaz de Syncthing')
    } finally {
      setSyncthingUiBusy(false)
    }
  }
  const chooseMobileFolder = async () => {
    setMobileBusy(true)
    setMobileMessage('')
    try {
      const folder = await window.planner.mobileSync.chooseFolder()
      if (folder) {
        setMobileFolder(folder)
        setMobileMessage('Carpeta compartida configurada.')
      }
    } catch (error) {
      reportAppError(error, 'No se pudo elegir la carpeta compartida')
    } finally {
      setMobileBusy(false)
    }
  }
  const exportMobileCatalog = async () => {
    setMobileBusy(true)
    setMobileMessage('')
    setMobileExportReport(null)
    try {
      const result = await window.planner.mobileSync.exportCatalog()
      if (result) {
        setMobileExportReport(result)
        setMobileMessage(`Lote ${result.batch} enviado: ${result.publications} ${result.publications === 1 ? 'publicación' : 'publicaciones'} y ${result.destinations} ${result.destinations === 1 ? 'destino' : 'destinos'} en el catálogo.${result.skipped.length ? ` Se omitieron ${result.skipped.length} publicaciones.` : ''}`)
      }
    } catch (error) {
      reportAppError(error, 'No se pudo exportar el snapshot móvil')
    } finally {
      setMobileBusy(false)
    }
  }
  const importMobileEvents = async () => {
    setMobileBusy(true)
    setMobileMessage('')
    setMobileReport(null)
    try {
      const report = await window.planner.mobileSync.importEvents()
      setMobileReport(report)
      setMobileMessage(`Importados: ${report.imported} · repetidos: ${report.duplicates} · inválidos: ${report.invalid.length} · sin coincidencia: ${report.unknown.length}`)
      setMobileHistory(await window.planner.mobileSync.history())
    } catch (error) {
      reportAppError(error, 'No se pudieron importar las confirmaciones móviles')
    } finally {
      setMobileBusy(false)
    }
  }
  return <section className="workspace about-workspace">
    <ViewHeading title="Acerca de / Actualizaciones" subtitle="Versión, datos locales y actualizaciones de caballocci." />
    <div className="about-layout">
      <section className="settings-section">
        <div className="settings-heading"><div><span>APLICACIÓN</span><h2>caballocci</h2></div><strong>v{info?.version || update?.installedVersion || '...'}</strong></div>
        <div className={`update-state ${update?.status || 'idle'}`}><span /><div><strong>{update?.message || 'Consultando estado...'}</strong>{update?.availableVersion && <small>Versión disponible: {update.availableVersion}</small>}</div></div>
        {update?.status === 'downloading' && <div className="download-progress"><div><span>Descarga</span><b>{Math.round(update.percent || 0)}%</b></div><progress max="100" value={update.percent || 0} /><small>{formatBytes(update.transferred)} de {formatBytes(update.total)}</small></div>}
        <div className="settings-actions">
          <button className="settings-button" disabled={busy || update?.status === 'unavailable' || update?.status === 'downloaded'} onClick={() => void runWithErrorReporting(() => window.planner.updates.check(), 'No se pudieron buscar actualizaciones')}><RefreshCw size={16} /> Buscar actualizaciones</button>
          {(update?.status === 'available' || (update?.status === 'error' && update.availableVersion)) && <button className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.download(), 'No se pudo descargar la actualización')}><Download size={16} /> {update.status === 'error' ? 'Reintentar descarga' : 'Descargar actualización'}</button>}
          {update?.status === 'downloaded' && <button className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.install(), 'No se pudo instalar la actualización')}><RotateCw size={16} /> Reiniciar y actualizar</button>}
        </div>
        {update?.availableVersion && <div className="settings-actions update-notes-actions">
          <button className="settings-button" aria-expanded={notesOpen} onClick={() => setNotesOpen(open => !open)}><BookOpen size={15} /> {notesOpen ? 'Ocultar novedades' : 'Ver novedades'}</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.updates.openReleaseNotes(), 'No se pudieron abrir las notas de versión')}><ExternalLink size={14} /> Ver en GitHub</button>
        </div>}
        {notesOpen && update?.availableVersion && <div className="release-notes">
          <strong>Novedades de la versión {update.availableVersion}</strong>
          <p>{update.releaseNotes || 'El lanzamiento no incluye notas detalladas. Puedes consultar la publicación en GitHub.'}</p>
        </div>}
        {update?.status === 'downloaded' && <p className="settings-note success">La actualización se aplicará en segundo plano y caballocci volverá a abrirse.</p>}
        {!info?.packaged && <p className="settings-note">La comprobación de actualizaciones está deshabilitada durante el desarrollo. Se activa en el instalador empaquetado.</p>}
      </section>
      <section className="settings-section">
        <div className="settings-heading"><div><span>DATOS LOCALES</span><h2>Workspace</h2></div></div>
        <dl className="path-list"><div><dt>Ubicación del workspace</dt><dd>{info?.workspacePath || '...'}</dd></div><div><dt>Carpeta de backups</dt><dd>{info?.backupsPath || '...'}</dd></div></dl>
        <div className="settings-actions">
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.system.openWorkspace(), 'No se pudo abrir el workspace')}><FolderOpen size={16} /> Abrir workspace</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.system.openBackups(), 'No se pudo abrir la carpeta de backups')}><Archive size={16} /> Abrir backups</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(createBackup, 'No se pudo crear el backup')}><Archive size={16} /> Crear backup ahora</button>
        </div>
        {backupMessage && <p className="settings-note success">{backupMessage}</p>}
      </section>
      <section className="settings-section mobile-sync-section">
        <details className="mobile-sync-details">
          <summary>
            <span className="mobile-sync-summary-icon"><Smartphone size={18} /></span>
            <span className="mobile-sync-summary-copy"><b>App Android de caballocci</b><small>Integración opcional · {mobileFolder ? 'Carpeta compartida configurada' : 'Aún no configurada'}</small></span>
            <span className="mobile-sync-summary-action">Ver cómo funciona</span>
          </summary>
          <div className="mobile-sync-content">
            <p className="mobile-sync-intro">La app complementaria para Android (Capacitor) muestra tus publicaciones y permite confirmar el uso por destino. Syncthing solo transporta archivos: no reemplaza la app ni comparte la base de datos.</p>
            <section className="syncthing-ui-settings" aria-labelledby="syncthing-ui-title">
              <div className="syncthing-ui-heading"><Globe2 size={16} /><div><b id="syncthing-ui-title">Interfaz de Syncthing en este PC</b><small>Guarda la dirección local para abrir y configurar las carpetas compartidas.</small></div></div>
              <label htmlFor="syncthing-ui-url">Dirección web<input id="syncthing-ui-url" type="url" value={syncthingUiUrl} maxLength={2048} onChange={event => setSyncthingUiUrl(event.target.value)} placeholder={defaultSyncthingUiUrl} /></label>
              <div className="settings-actions">
                <button className="settings-button" disabled={syncthingUiBusy} onClick={() => void saveSyncthingUiUrl(false)}>{syncthingUiBusy ? 'Guardando…' : 'Guardar dirección'}</button>
                <button className="settings-button primary" disabled={syncthingUiBusy} onClick={() => void saveSyncthingUiUrl(true)}><ExternalLink size={14} /> {syncthingUiBusy ? 'Abriendo…' : 'Guardar y abrir Syncthing'}</button>
              </div>
              {syncthingUiMessage && <p className={`settings-note ${syncthingUiError ? 'error' : 'success'}`} role={syncthingUiError ? 'alert' : 'status'}>{syncthingUiMessage}</p>}
            </section>
            <p className="settings-note">Crea o elige una sola <strong>carpeta raíz de sincronización</strong> en el PC y compártela con Android. El modo recomendado para esta carpeta es <strong>Enviar y recibir en ambos dispositivos</strong>: el PC envía publicaciones y el celular devuelve confirmaciones. Por ejemplo, la raíz puede estar en <code>C:\Users\tu-usuario\Syncthing\Caballocci-Sync</code> en el PC y en <code>Pictures/Caballocci</code> en Android; son ubicaciones locales de la misma carpeta compartida.</p>
            <pre className="mobile-sync-tree">{`Caballocci-Sync/                 ← raíz: la eliges y compartes en Syncthing
├── pc-outbox/                   ← caballocci la crea al exportar (PC → Android)
│   ├── catalog.json
│   └── publications/             ← catálogo y medios por publicación
└── android-inbox/                ← la app Android la crea al confirmar (Android → PC)
    └── <dispositivo>/`}</pre>
            <p className="settings-note"><strong>Configura la carpeta compartida como Enviar y recibir tanto en Syncthing del PC como en Syncthing-Fork de Android.</strong> No uses Solo enviar ni Solo recibir en esta carpeta: en esos modos, las confirmaciones no volverán al PC. Solo eliges y compartes la raíz; no crees <code>pc-outbox</code> ni <code>android-inbox</code>, las aplicaciones las generan. La carpeta elegida aquí y la del envío de álbumes en el editor tienen configuraciones independientes, pero puedes elegir la misma carpeta física para ambas.</p>
            <section className="mobile-app-download" aria-labelledby="mobile-app-download-title">
              <div><b id="mobile-app-download-title">¿Aún no tienes la app en Android?</b><span>Descarga el APK oficial de la última versión de caballocci.</span></div>
              <MobileAppDownload className="settings-button primary" />
              <ol>
                <li>Abre el APK descargado en el teléfono.</li>
                <li>Si Android lo solicita, permite instalar apps desde esa fuente y confirma la instalación.</li>
                <li>Abre caballocci y elige la raíz compartida de Syncthing.</li>
              </ol>
            </section>
            <ol className="mobile-sync-steps">
              <li><b>Inicio · conecta la raíz</b><span>En Syncthing del PC, comparte la carpeta raíz con el teléfono. En Syncthing-Fork, acepta la carpeta y elige su ubicación local. Selecciona la carpeta compartida del PC en caballocci y su ubicación sincronizada en Android; son rutas locales distintas de la misma raíz.</span></li>
              <li><b>En medio · exporta en lote</b><span>Este botón exporta todas las publicaciones no archivadas que tengan medios y al menos un destino cuyo estado no sea Publicado ni No aplica. Crea el catálogo en <code>pc-outbox/catalog.json</code> y organiza los medios bajo <code>pc-outbox/publications/</code>; la app Android las muestra por destino.</span></li>
              <li><b>Final · devuelve confirmaciones</b><span>Marca un destino como usado en Android. La app crea <code>android-inbox/&lt;dispositivo&gt;/</code>; Syncthing lo replica al PC y puedes pulsar <strong>Importar confirmaciones</strong>.</span></li>
            </ol>
            <dl className="path-list"><div><dt>Raíz compartida en este PC</dt><dd>{mobileFolder || 'Sin configurar'}</dd></div></dl>
            <div className="settings-actions">
              <button className="settings-button" disabled={mobileBusy} onClick={() => void chooseMobileFolder()}><FolderOpen size={15} /> Elegir carpeta raíz</button>
              <button className="settings-button primary" disabled={mobileBusy} onClick={() => void exportMobileCatalog()}><Download size={15} /> Exportar todas las publicaciones</button>
              <button className="settings-button" disabled={mobileBusy || !mobileFolder} onClick={() => void importMobileEvents()}><RefreshCw size={15} /> Importar confirmaciones</button>
            </div>
            {mobileMessage && <p className="settings-note success" role="status">{mobileMessage}</p>}
            {mobileExportReport?.skipped.length ? <div className="release-notes">
              <strong>Publicaciones omitidas</strong>
              {mobileExportReport.skipped.map(item => <p key={item.postId}>{item.title || item.postId}: {item.reason}</p>)}
            </div> : null}
            {mobileReport && (mobileReport.invalid.length > 0 || mobileReport.unknown.length > 0) && <div className="release-notes">
              <strong>Eventos que requieren atención</strong>
              {mobileReport.invalid.map(item => <p key={item.file}>{item.file}: {item.reason}</p>)}
              {mobileReport.unknown.map(item => <p key={item.file}>{item.file}: no existe la publicación/destino {item.postId} / {item.targetId}.</p>)}
            </div>}
            <div className="mobile-history">
              <strong>Historial de confirmaciones recibidas</strong>
              {mobileHistory.length === 0 && <p className="settings-note">Todavía no hay eventos importados.</p>}
              {mobileHistory.map(event => <div className="mobile-history-row" key={event.eventId}>
                <span><b>{event.postTitle || event.postId}</b><small>{event.targetName} · {event.postId}</small></span>
                <time dateTime={event.usedAt}>{new Date(event.usedAt).toLocaleString()}</time>
              </div>)}
            </div>
            <p className="settings-note">“Usada” confirma una acción de la persona, no una publicación en redes; importar no cambia estados editoriales.</p>
          </div>
        </details>
      </section>
    </div>
  </section>
}
