import { useEffect, useState } from 'react'
import { Archive, BookOpen, Download, ExternalLink, FolderOpen, Globe2, RefreshCw, RotateCw, Smartphone } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ViewHeading } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import type { MobileCatalogStatus, MobileExportReport, MobileImportReport, MobileReconcilePreview, MobileUsageRecord, SystemInfo, UpdateState } from '../../shared/types'
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
  const [mobileCatalogStatus, setMobileCatalogStatus] = useState<MobileCatalogStatus | null>(null)
  const [mobileMessage, setMobileMessage] = useState('')
  const [mobileStatusMessage, setMobileStatusMessage] = useState('')
  const [catalogPreview, setCatalogPreview] = useState<{ path: string; text: string } | null>(null)
  const [catalogBackups, setCatalogBackups] = useState<Array<{ name: string; createdAt: string; publications: number; destinations: number; batches: number }>>([])
  const [catalogBackupsOpen, setCatalogBackupsOpen] = useState(false)
  const [catalogBackupsBusy, setCatalogBackupsBusy] = useState(false)
  const [mobileBusy, setMobileBusy] = useState(false)
  const [mobileExportReport, setMobileExportReport] = useState<MobileExportReport | null>(null)
  const [mobileReport, setMobileReport] = useState<MobileImportReport | null>(null)
  const [mobileHistory, setMobileHistory] = useState<MobileUsageRecord[]>([])
  const [mobileHistoryBusy, setMobileHistoryBusy] = useState(false)
  const [syncthingUiUrl, setSyncthingUiUrl] = useState(() => localStorage.getItem(syncthingUiPreferenceKey) || defaultSyncthingUiUrl)
  const [syncthingUiBusy, setSyncthingUiBusy] = useState(false)
  const [syncthingUiMessage, setSyncthingUiMessage] = useState('')
  const [syncthingUiError, setSyncthingUiError] = useState(false)

  const refreshMobileStatus = async () => {
    const status = await window.planner.mobileSync.status()
    setMobileCatalogStatus(status)
    const checkedAt = new Date().toLocaleTimeString()
    if (!status.configured) setMobileStatusMessage(`Comprobación terminada a las ${checkedAt}: elige primero la carpeta raíz de Syncthing.`)
    else if (!status.catalogExists) setMobileStatusMessage(`Comprobación terminada a las ${checkedAt}: todavía no existe pc-outbox/catalog.json.`)
    else setMobileStatusMessage(`Inspección de solo lectura terminada a las ${checkedAt}: ${status.referencedDestinations} destinos en ${status.referencedAlbums} carpetas referenciadas; ${status.availableAlbums} presentes, ${status.missingAlbums.length} ausentes, ${status.incompleteAlbums.length} incompletas y ${status.unreferencedAlbums.length} carpetas sin referencia. No se modificó el catálogo ni se borraron archivos.`)
    return status
  }

  useEffect(() => {
    void Promise.all([window.planner.system.info(), window.planner.updates.getState()]).then(([system, state]) => {
      setInfo(system)
      setUpdate(state)
    }).catch(error => reportAppError(error, 'No se pudo cargar la información de la aplicación'))
    void window.planner.mobileSync.folder().then(setMobileFolder).catch(error => reportAppError(error, 'No se pudo consultar la carpeta de sincronización'))
    void window.planner.mobileSync.history().then(setMobileHistory).catch(error => reportAppError(error, 'No se pudo consultar el historial móvil'))
    void window.planner.mobileSync.status().then(setMobileCatalogStatus).catch(error => reportAppError(error, 'No se pudo revisar el catálogo móvil'))
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
        await refreshMobileStatus()
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
        setMobileHistory(await window.planner.mobileSync.history())
        await refreshMobileStatus()
        setMobileMessage(`Lote ${result.batch} enviado: ${result.publications} ${result.publications === 1 ? 'publicación' : 'publicaciones'} y ${result.destinations} ${result.destinations === 1 ? 'destino' : 'destinos'} en el catálogo.${result.skipped.length ? ` Se omitieron ${result.skipped.length} publicaciones.` : ''}`)
        if (result.missingAlbums.length) setMobileMessage(value => value + ` Se retiraron ${result.missingAlbums.length} referencias a carpetas ausentes.`)
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
      setMobileMessage(`Importados: ${report.imported}${report.removed ? ` (${report.removed} señales de retiro)` : ''} · repetidos: ${report.duplicates} · inválidos: ${report.invalid.length} · sin coincidencia: ${report.unknown.length}. El catálogo y las carpetas no se cambiaron; usa “Conciliar, archivar y limpiar” para revisar los cambios antes de aplicarlos.`)
      setMobileHistory(await window.planner.mobileSync.history())
      await refreshMobileStatus()
    } catch (error) {
      reportAppError(error, 'No se pudieron importar las confirmaciones móviles')
    } finally {
      setMobileBusy(false)
    }
  }
  const reconcileMobileCatalog = async () => {
    setMobileBusy(true)
    setMobileMessage('')
    try {
      const preview: MobileReconcilePreview = await window.planner.mobileSync.previewReconcile()
      const folders = preview.foldersToDelete.length ? `\n\nSe borrarán de pc-outbox/publications estas carpetas: ${preview.foldersToDelete.join(', ')}.` : '\n\nNo hay carpetas presentes para borrar.'
      const missing = preview.missingAlbums.length ? `\nCarpetas ya ausentes detectadas: ${preview.missingAlbums.join(', ')}.` : ''
      const renames = preview.foldersToRename.length ? `\n\nSe marcarán como usadas estas carpetas: ${preview.foldersToRename.map(item => `${item.from} → ${item.to}`).join(', ')}.` : ''
      if (preview.renameConflicts.length) {
        setMobileMessage(`No se puede conciliar porque ya existen carpetas con los nombres de destino: ${preview.renameConflicts.join(', ')}.`)
        return
      }
      const confirmed = window.confirm(`La PC guardará una copia exacta del catálogo en pc-outbox/catalog-history/ y conciliará ${preview.retiredDestinations} destinos.${missing}${folders}${renames}\n\nEspera a que Syncthing termine y no borres álbumes desde Android durante esta operación. ¿Continuar?`)
      if (!confirmed) {
        setMobileMessage('Conciliación cancelada; no se cambió el catálogo ni se borraron carpetas.')
        return
      }
      const result = await window.planner.mobileSync.reconcile()
      const backup = result.catalogBackupPath ? ` Copia exacta guardada: ${result.catalogBackupPath}.` : ' No se pudo crear una copia del catálogo.'
      const failed = result.cleanupFailed.length ? ` No se pudieron borrar: ${result.cleanupFailed.join(', ')}.` : ''
      setMobileMessage(`Conciliación completada: ${result.missingAlbums.length} carpetas ya ausentes, ${result.pruned} destinos retirados y ${result.cleaned} carpetas borradas de la sincronización.${backup}${failed}`)
      await Promise.all([refreshMobileStatus(), window.planner.mobileSync.history().then(setMobileHistory)])
    } catch (error) {
      reportAppError(error, 'No se pudo reconciliar el catálogo móvil')
    } finally {
      setMobileBusy(false)
    }
  }
  const previewMobileCatalog = async (archiveName?: string) => {
    setMobileBusy(true)
    try {
      setCatalogPreview(await window.planner.mobileSync.readCatalog(archiveName))
    } catch (error) {
      reportAppError(error, 'No se pudo leer catalog.json')
    } finally {
      setMobileBusy(false)
    }
  }
  const toggleCatalogBackups = async () => {
    if (catalogBackupsOpen) {
      setCatalogBackupsOpen(false)
      return
    }
    setCatalogBackupsBusy(true)
    try {
      setCatalogBackups(await window.planner.mobileSync.listCatalogBackups())
      setCatalogBackupsOpen(true)
    } catch (error) {
      reportAppError(error, 'No se pudieron consultar las copias del catálogo')
    } finally {
      setCatalogBackupsBusy(false)
    }
  }
  const refreshMobileHistory = async () => {
    setMobileHistoryBusy(true)
    try {
      setMobileHistory(await window.planner.mobileSync.history())
    } catch (error) {
      reportAppError(error, 'No se pudo actualizar el historial móvil')
    } finally {
      setMobileHistoryBusy(false)
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
            {mobileCatalogStatus?.configured && <section className={`mobile-catalog-integrity${mobileCatalogStatus.missingAlbums.length || mobileCatalogStatus.incompleteAlbums.length || mobileCatalogStatus.unreferencedAlbums.length ? ' warning' : ''}`}>
              <strong>Estado del catálogo frente a la carpeta</strong>
              {!mobileCatalogStatus.catalogExists
                ? <p>Aún no existe <code>pc-outbox/catalog.json</code>. Exporta publicaciones para crearlo.</p>
                : <p>{mobileCatalogStatus.referencedDestinations} destinos referenciados en {mobileCatalogStatus.referencedAlbums} carpetas: {mobileCatalogStatus.availableAlbums} presentes, {mobileCatalogStatus.missingAlbums.length} ausentes y {mobileCatalogStatus.incompleteAlbums.length} incompletas. Hay además {mobileCatalogStatus.unreferencedAlbums.length} carpetas de álbum sin entrada en el catálogo.</p>}
              {mobileCatalogStatus.missingAlbums.length > 0 && <>
                <p>Hay referencias en el catálogo cuyos álbumes ya no existen. La conciliación guardará primero una copia exacta de <code>catalog.json</code> en <code>pc-outbox/catalog-history/</code> y luego retirará esas referencias.</p>
                <ul>{mobileCatalogStatus.missingAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              {mobileCatalogStatus.incompleteAlbums.length > 0 && <>
                <p>Estas carpetas existen, pero todavía no tienen <code>manifest.json</code>. Puede ser una sincronización en curso; se conservan y no se retirarán automáticamente.</p>
                <ul>{mobileCatalogStatus.incompleteAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              {mobileCatalogStatus.unreferencedAlbums.length > 0 && <>
                <p>Estas carpetas contienen un manifiesto pero no aparecen en el catálogo. La conciliación las propone para borrado de la carpeta sincronizada; la vista previa enumerará cada una antes de confirmar.</p>
                <ul>{mobileCatalogStatus.unreferencedAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              <div className="settings-actions">
                <button className="settings-button" disabled={mobileBusy || !mobileCatalogStatus.catalogExists} onClick={() => void previewMobileCatalog()}><FolderOpen size={15} /> Ver catálogo actual</button>
                <button className="settings-button" disabled={mobileBusy || catalogBackupsBusy} onClick={() => void toggleCatalogBackups()}><Archive size={15} /> {catalogBackupsBusy ? 'Cargando copias…' : catalogBackupsOpen ? 'Ocultar copias' : `Explorar copias (${mobileCatalogStatus.archivedCatalogs})`}</button>
                <button className="settings-button" disabled={mobileBusy} onClick={() => void runWithErrorReporting(() => window.planner.mobileSync.openCatalogHistory(), 'No se pudo abrir el historial del catálogo')}><Archive size={15} /> Abrir carpeta de copias</button>
                <button className="settings-button primary" disabled={mobileBusy || !mobileCatalogStatus.catalogExists} onClick={() => void reconcileMobileCatalog()}>Conciliar, archivar y limpiar</button>
              </div>
              {catalogBackupsOpen && <div className="catalog-backup-browser" aria-label="Copias archivadas del catálogo">
                {catalogBackups.length === 0 ? <p>No hay copias archivadas todavía. Se crearán al cambiar el catálogo durante una exportación o conciliación.</p> : <ol>
                  {catalogBackups.map(backup => {
                    const date = new Date(backup.createdAt)
                    return <li key={backup.name}>
                      <div><b>{Number.isNaN(date.getTime()) ? backup.name : date.toLocaleString()}</b><small>{backup.publications} publicaciones · {backup.destinations} destinos · {backup.batches} {backup.batches === 1 ? 'lote' : 'lotes'}</small><code>{backup.name}</code></div>
                      <button type="button" className="settings-button" disabled={mobileBusy} onClick={() => void previewMobileCatalog(backup.name)}>Abrir vista previa</button>
                    </li>
                  })}
                </ol>}
              </div>}
              <p className="catalog-grouping-note"><strong>Cómo se agrupa:</strong> cada lote identifica publicaciones exportadas juntas y se conserva al actualizar el catálogo. La conciliación retira destinos individualmente; solo borra la carpeta de un álbum cuando ya no queda ninguna referencia a ella.</p>
              <p>La PC es quien actualiza el catálogo y elimina de la carpeta compartida los álbumes que ya no deben estar allí. Android puede enviar señales y borrar un álbum; importa primero las confirmaciones para incluir esas señales en la vista previa, espera a que Syncthing termine y evita borrar álbumes desde Android mientras concilias.</p>
              <button className="settings-button" disabled={mobileBusy} onClick={() => void refreshMobileStatus().catch(error => reportAppError(error, 'No se pudo actualizar el estado de carpetas'))}>Actualizar estado de carpetas (solo lectura)</button>
              {mobileStatusMessage && <small className="catalog-status-feedback" role="status">{mobileStatusMessage}</small>}
              <small>{mobileCatalogStatus.archivedCatalogs} copias de catálogo guardadas{mobileCatalogStatus.latestCatalogBackupPath ? ` · última: ${mobileCatalogStatus.latestCatalogBackupPath}` : ''}</small>
            </section>}
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
│   ├── catalog.json             ← catálogo actual, creado y mantenido por el PC
│   ├── catalog-history/         ← copias previas antes de conciliar
│   └── publications/             ← medios por publicación
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
            {mobileExportReport && (mobileExportReport.missingAlbums.length > 0 || mobileExportReport.catalogBackupPaths.length > 0) ? <div className="release-notes">
              <strong>Revisión del catálogo antes de exportar</strong>
              {mobileExportReport.missingAlbums.map(folder => <p key={folder}>{folder}: referencia retirada; se volverá a preparar si la publicación sigue elegible.</p>)}
              {mobileExportReport.catalogBackupPaths.map(path => <p key={path}>Copia previa guardada: {path}</p>)}
            </div> : null}
            {mobileReport && (mobileReport.invalid.length > 0 || mobileReport.unknown.length > 0 || mobileReport.missingAlbums.length > 0 || mobileReport.catalogBackupPaths.length > 0) && <div className="release-notes">
              <strong>Eventos que requieren atención</strong>
              {mobileReport.invalid.map(item => <p key={item.file}>{item.file}: {item.reason}</p>)}
              {mobileReport.unknown.map(item => <p key={item.file}>{item.file}: no existe la publicación/destino {item.postId} / {item.targetId}.</p>)}
              {mobileReport.missingAlbums.map(folder => <p key={folder}>{folder}: carpeta ausente en pc-outbox/publications; se quitó del catálogo.</p>)}
              {mobileReport.catalogBackupPaths.map(path => <p key={path}>Catálogo anterior guardado en: {path}</p>)}
            </div>}
            <section className="mobile-history" aria-labelledby="mobile-history-title">
              <header className="mobile-history-heading">
                <div><strong id="mobile-history-title">Historial de actividad móvil</strong><small>{mobileHistory.length ? `${mobileHistory.length} ${mobileHistory.length === 1 ? 'evento reciente' : 'eventos recientes'}` : 'Actividad recibida desde el móvil'}</small></div>
                <button type="button" className="settings-button mobile-history-refresh" disabled={mobileHistoryBusy} onClick={() => void refreshMobileHistory()} aria-label="Actualizar historial móvil">
                  <RefreshCw size={13} className={mobileHistoryBusy ? 'mobile-history-spinning' : ''} /> Actualizar
                </button>
              </header>
              {mobileHistory.length === 0 && <p className="mobile-history-empty">Todavía no hay eventos importados. Cuando importes confirmaciones del móvil, aparecerán aquí.</p>}
              {mobileHistory.length > 0 && <ol className="mobile-history-list">
                {mobileHistory.map(event => {
                  const actionLabel = event.action === 'removed' ? 'Retirada del móvil' : event.action === 'folder_missing' ? 'Carpeta ausente' : 'Marcada como usada'
                  const date = new Date(event.usedAt)
                  const validDate = !Number.isNaN(date.getTime())
                  return <li className="mobile-history-row" key={event.eventId}>
                    <div className="mobile-history-event">
                      <div className="mobile-history-event-top"><span className={`mobile-history-action ${event.action}`}>{actionLabel}</span><b>{event.postTitle || event.postId}</b></div>
                      <small>{event.targetName || event.targetId || 'Sin destino'}<span aria-hidden="true"> · </span><code>{event.postId}</code></small>
                      {event.deviceId && <small className="mobile-history-device"><Smartphone size={11} aria-hidden="true" /> {event.deviceId}</small>}
                      {event.action === 'folder_missing' && event.reason && <small className="mobile-history-reason">{event.reason}</small>}
                    </div>
                    <time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toLocaleString() : undefined}>{validDate ? date.toLocaleString() : 'Fecha desconocida'}</time>
                  </li>
                })}
              </ol>}
            </section>
            <p className="settings-note">“Usada” confirma una acción de la persona, no una publicación en redes; importar no cambia estados editoriales.</p>
          </div>
        </details>
      </section>
    </div>
    {catalogPreview && <div className="catalog-preview-backdrop" role="presentation" onClick={() => setCatalogPreview(null)}>
      <section className="catalog-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-preview-title" onClick={event => event.stopPropagation()}>
        <header><div><h2 id="catalog-preview-title">{catalogPreview.path.includes('catalog-history') ? 'Copia archivada del catálogo' : 'Catálogo móvil actual'}</h2><small>{catalogPreview.path}</small></div><button className="settings-button" onClick={() => setCatalogPreview(null)}>Cerrar</button></header>
        <pre>{catalogPreview.text}</pre>
      </section>
    </div>}
  </section>
}
