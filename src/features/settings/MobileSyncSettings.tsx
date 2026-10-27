import { useEffect, useState } from 'react'
import { Archive, Download, FolderOpen, RefreshCw, Smartphone } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { SyncthingUiSettings } from './SyncthingUiSettings'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import type { MobileCatalogStatus, MobileExportReport, MobileImportReport, MobileReconcilePreview, MobileUsageRecord } from '../../shared/types'

export function MobileSyncSettings() {
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

  const refreshMobileStatus = async () => {
    const status = await window.planner.mobileSync.status()
    setMobileCatalogStatus(status)
    const checkedAt = new Date().toLocaleTimeString()
    if (!status.configured) setMobileStatusMessage(`Comprobaci�n terminada a las ${checkedAt}: elige primero la carpeta ra�z de Syncthing.`)
    else if (!status.catalogExists) setMobileStatusMessage(`Comprobaci�n terminada a las ${checkedAt}: todav�a no existe pc-outbox/catalog.json.`)
    else setMobileStatusMessage(`Inspecci�n de solo lectura terminada a las ${checkedAt}: ${status.referencedDestinations} destinos en ${status.referencedAlbums} carpetas referenciadas; ${status.availableAlbums} presentes, ${status.missingAlbums.length} ausentes, ${status.incompleteAlbums.length} incompletas y ${status.unreferencedAlbums.length} carpetas sin referencia. No se modific� el cat�logo ni se borraron archivos.`)
    return status
  }

  useEffect(() => {
    void window.planner.mobileSync.folder().then(setMobileFolder).catch(error => reportAppError(error, 'No se pudo consultar la carpeta de sincronizaci�n'))
    void window.planner.mobileSync.history().then(setMobileHistory).catch(error => reportAppError(error, 'No se pudo consultar el historial m�vil'))
    void window.planner.mobileSync.status().then(setMobileCatalogStatus).catch(error => reportAppError(error, 'No se pudo revisar el cat�logo m�vil'))
  }, [])
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
        setMobileMessage(`Lote ${result.batch} enviado: ${result.publications} ${result.publications === 1 ? 'publicaci�n' : 'publicaciones'} y ${result.destinations} ${result.destinations === 1 ? 'destino' : 'destinos'} en el cat�logo.${result.skipped.length ? ` Se omitieron ${result.skipped.length} publicaciones.` : ''}`)
        if (result.missingAlbums.length) setMobileMessage(value => value + ` Se retiraron ${result.missingAlbums.length} referencias a carpetas ausentes.`)
      }
    } catch (error) {
      reportAppError(error, 'No se pudo exportar el snapshot m�vil')
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
      setMobileMessage(`Importados: ${report.imported}${report.removed ? ` (${report.removed} se�ales de retiro)` : ''} � repetidos: ${report.duplicates} � inv�lidos: ${report.invalid.length} � sin coincidencia: ${report.unknown.length}. El cat�logo y las carpetas no se cambiaron; usa �Conciliar, archivar y limpiar� para revisar los cambios antes de aplicarlos.`)
      setMobileHistory(await window.planner.mobileSync.history())
      await refreshMobileStatus()
    } catch (error) {
      reportAppError(error, 'No se pudieron importar las confirmaciones m�viles')
    } finally {
      setMobileBusy(false)
    }
  }
  const reconcileMobileCatalog = async () => {
    setMobileBusy(true)
    setMobileMessage('')
    try {
      const preview: MobileReconcilePreview = await window.planner.mobileSync.previewReconcile()
      const folders = preview.foldersToDelete.length ? `\n\nSe borrar�n de pc-outbox/publications estas carpetas: ${preview.foldersToDelete.join(', ')}.` : '\n\nNo hay carpetas presentes para borrar.'
      const missing = preview.missingAlbums.length ? `\nCarpetas ya ausentes detectadas: ${preview.missingAlbums.join(', ')}.` : ''
      const renames = preview.foldersToRename.length ? `\n\nSe marcar�n como usadas estas carpetas: ${preview.foldersToRename.map(item => `${item.from} ? ${item.to}`).join(', ')}.` : ''
      if (preview.renameConflicts.length) {
        setMobileMessage(`No se puede conciliar porque ya existen carpetas con los nombres de destino: ${preview.renameConflicts.join(', ')}.`)
        return
      }
      const confirmed = window.confirm(`La PC guardar� una copia exacta del cat�logo en pc-outbox/catalog-history/ y conciliar� ${preview.retiredDestinations} destinos.${missing}${folders}${renames}\n\nEspera a que Syncthing termine y no borres �lbumes desde Android durante esta operaci�n. �Continuar?`)
      if (!confirmed) {
        setMobileMessage('Conciliaci�n cancelada; no se cambi� el cat�logo ni se borraron carpetas.')
        return
      }
      const result = await window.planner.mobileSync.reconcile()
      const backup = result.catalogBackupPath ? ` Copia exacta guardada: ${result.catalogBackupPath}.` : ' No se pudo crear una copia del cat�logo.'
      const failed = result.cleanupFailed.length ? ` No se pudieron borrar: ${result.cleanupFailed.join(', ')}.` : ''
      setMobileMessage(`Conciliaci�n completada: ${result.missingAlbums.length} carpetas ya ausentes, ${result.pruned} destinos retirados y ${result.cleaned} carpetas borradas de la sincronizaci�n.${backup}${failed}`)
      await Promise.all([refreshMobileStatus(), window.planner.mobileSync.history().then(setMobileHistory)])
    } catch (error) {
      reportAppError(error, 'No se pudo reconciliar el cat�logo m�vil')
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
      reportAppError(error, 'No se pudieron consultar las copias del cat�logo')
    } finally {
      setCatalogBackupsBusy(false)
    }
  }
  const refreshMobileHistory = async () => {
    setMobileHistoryBusy(true)
    try {
      setMobileHistory(await window.planner.mobileSync.history())
    } catch (error) {
      reportAppError(error, 'No se pudo actualizar el historial m�vil')
    } finally {
      setMobileHistoryBusy(false)
    }
  }
  return <>
      <section className="settings-section mobile-sync-section">
        <details className="mobile-sync-details">
          <summary>
            <span className="mobile-sync-summary-icon"><Smartphone size={18} /></span>
            <span className="mobile-sync-summary-copy"><b>App Android de caballocci</b><small>Integraci�n opcional � {mobileFolder ? 'Carpeta compartida configurada' : 'A�n no configurada'}</small></span>
            <span className="mobile-sync-summary-action">Ver c�mo funciona</span>
          </summary>
          <div className="mobile-sync-content">
            <p className="mobile-sync-intro">La app complementaria para Android (Capacitor) muestra tus publicaciones y permite confirmar el uso por destino. Syncthing solo transporta archivos: no reemplaza la app ni comparte la base de datos.</p>
            {mobileCatalogStatus?.configured && <section className={`mobile-catalog-integrity${mobileCatalogStatus.missingAlbums.length || mobileCatalogStatus.incompleteAlbums.length || mobileCatalogStatus.unreferencedAlbums.length ? ' warning' : ''}`}>
              <strong>Estado del cat�logo frente a la carpeta</strong>
              {!mobileCatalogStatus.catalogExists
                ? <p>A�n no existe <code>pc-outbox/catalog.json</code>. Exporta publicaciones para crearlo.</p>
                : <p>{mobileCatalogStatus.referencedDestinations} destinos referenciados en {mobileCatalogStatus.referencedAlbums} carpetas: {mobileCatalogStatus.availableAlbums} presentes, {mobileCatalogStatus.missingAlbums.length} ausentes y {mobileCatalogStatus.incompleteAlbums.length} incompletas. Hay adem�s {mobileCatalogStatus.unreferencedAlbums.length} carpetas de �lbum sin entrada en el cat�logo.</p>}
              {mobileCatalogStatus.missingAlbums.length > 0 && <>
                <p>Hay referencias en el cat�logo cuyos �lbumes ya no existen. La conciliaci�n guardar� primero una copia exacta de <code>catalog.json</code> en <code>pc-outbox/catalog-history/</code> y luego retirar� esas referencias.</p>
                <ul>{mobileCatalogStatus.missingAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              {mobileCatalogStatus.incompleteAlbums.length > 0 && <>
                <p>Estas carpetas existen, pero todav�a no tienen <code>manifest.json</code>. Puede ser una sincronizaci�n en curso; se conservan y no se retirar�n autom�ticamente.</p>
                <ul>{mobileCatalogStatus.incompleteAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              {mobileCatalogStatus.unreferencedAlbums.length > 0 && <>
                <p>Estas carpetas contienen un manifiesto pero no aparecen en el cat�logo. La conciliaci�n las propone para borrado de la carpeta sincronizada; la vista previa enumerar� cada una antes de confirmar.</p>
                <ul>{mobileCatalogStatus.unreferencedAlbums.map(folder => <li key={folder}>{folder}</li>)}</ul>
              </>}
              <div className="settings-actions">
                <button className="settings-button" disabled={mobileBusy || !mobileCatalogStatus.catalogExists} onClick={() => void previewMobileCatalog()}><FolderOpen size={15} /> Ver cat�logo actual</button>
                <button className="settings-button" disabled={mobileBusy || catalogBackupsBusy} onClick={() => void toggleCatalogBackups()}><Archive size={15} /> {catalogBackupsBusy ? 'Cargando copias�' : catalogBackupsOpen ? 'Ocultar copias' : `Explorar copias (${mobileCatalogStatus.archivedCatalogs})`}</button>
                <button className="settings-button" disabled={mobileBusy} onClick={() => void runWithErrorReporting(() => window.planner.mobileSync.openCatalogHistory(), 'No se pudo abrir el historial del cat�logo')}><Archive size={15} /> Abrir carpeta de copias</button>
                <button className="settings-button primary" disabled={mobileBusy || !mobileCatalogStatus.catalogExists} onClick={() => void reconcileMobileCatalog()}>Conciliar, archivar y limpiar</button>
              </div>
              {catalogBackupsOpen && <div className="catalog-backup-browser" aria-label="Copias archivadas del cat�logo">
                {catalogBackups.length === 0 ? <p>No hay copias archivadas todav�a. Se crear�n al cambiar el cat�logo durante una exportaci�n o conciliaci�n.</p> : <ol>
                  {catalogBackups.map(backup => {
                    const date = new Date(backup.createdAt)
                    return <li key={backup.name}>
                      <div><b>{Number.isNaN(date.getTime()) ? backup.name : date.toLocaleString()}</b><small>{backup.publications} publicaciones � {backup.destinations} destinos � {backup.batches} {backup.batches === 1 ? 'lote' : 'lotes'}</small><code>{backup.name}</code></div>
                      <button type="button" className="settings-button" disabled={mobileBusy} onClick={() => void previewMobileCatalog(backup.name)}>Abrir vista previa</button>
                    </li>
                  })}
                </ol>}
              </div>}
              <p className="catalog-grouping-note"><strong>C�mo se agrupa:</strong> cada lote identifica publicaciones exportadas juntas y se conserva al actualizar el cat�logo. La conciliaci�n retira destinos individualmente; solo borra la carpeta de un �lbum cuando ya no queda ninguna referencia a ella.</p>
              <p>La PC es quien actualiza el cat�logo y elimina de la carpeta compartida los �lbumes que ya no deben estar all�. Android puede enviar se�ales y borrar un �lbum; importa primero las confirmaciones para incluir esas se�ales en la vista previa, espera a que Syncthing termine y evita borrar �lbumes desde Android mientras concilias.</p>
              <button className="settings-button" disabled={mobileBusy} onClick={() => void refreshMobileStatus().catch(error => reportAppError(error, 'No se pudo actualizar el estado de carpetas'))}>Actualizar estado de carpetas (solo lectura)</button>
              {mobileStatusMessage && <small className="catalog-status-feedback" role="status">{mobileStatusMessage}</small>}
              <small>{mobileCatalogStatus.archivedCatalogs} copias de cat�logo guardadas{mobileCatalogStatus.latestCatalogBackupPath ? ` � �ltima: ${mobileCatalogStatus.latestCatalogBackupPath}` : ''}</small>
            </section>}
            <SyncthingUiSettings />
            <p className="settings-note">Crea o elige una sola <strong>carpeta ra�z de sincronizaci�n</strong> en el PC y comp�rtela con Android. El modo recomendado para esta carpeta es <strong>Enviar y recibir en ambos dispositivos</strong>: el PC env�a publicaciones y el celular devuelve confirmaciones. Por ejemplo, la ra�z puede estar en <code>C:\Users\tu-usuario\Syncthing\Caballocci-Sync</code> en el PC y en <code>Pictures/Caballocci</code> en Android; son ubicaciones locales de la misma carpeta compartida.</p>
            <pre className="mobile-sync-tree">{`Caballocci-Sync/                 ? ra�z: la eliges y compartes en Syncthing
+-- pc-outbox/                   ? caballocci la crea al exportar (PC ? Android)
�   +-- catalog.json             ? cat�logo actual, creado y mantenido por el PC
�   +-- catalog-history/         ? copias previas antes de conciliar
�   +-- publications/             ? medios por publicaci�n
+-- android-inbox/                ? la app Android la crea al confirmar (Android ? PC)
    +-- <dispositivo>/`}</pre>
            <p className="settings-note"><strong>Configura la carpeta compartida como Enviar y recibir tanto en Syncthing del PC como en Syncthing-Fork de Android.</strong> No uses Solo enviar ni Solo recibir en esta carpeta: en esos modos, las confirmaciones no volver�n al PC. Solo eliges y compartes la ra�z; no crees <code>pc-outbox</code> ni <code>android-inbox</code>, las aplicaciones las generan. La carpeta elegida aqu� y la del env�o de �lbumes en el editor tienen configuraciones independientes, pero puedes elegir la misma carpeta f�sica para ambas.</p>
            <section className="mobile-app-download" aria-labelledby="mobile-app-download-title">
              <div><b id="mobile-app-download-title">�A�n no tienes la app en Android?</b><span>Descarga el APK oficial de la �ltima versi�n de caballocci.</span></div>
              <MobileAppDownload className="settings-button primary" />
              <ol>
                <li>Abre el APK descargado en el tel�fono.</li>
                <li>Si Android lo solicita, permite instalar apps desde esa fuente y confirma la instalaci�n.</li>
                <li>Abre caballocci y elige la ra�z compartida de Syncthing.</li>
              </ol>
            </section>
            <ol className="mobile-sync-steps">
              <li><b>Inicio � conecta la ra�z</b><span>En Syncthing del PC, comparte la carpeta ra�z con el tel�fono. En Syncthing-Fork, acepta la carpeta y elige su ubicaci�n local. Selecciona la carpeta compartida del PC en caballocci y su ubicaci�n sincronizada en Android; son rutas locales distintas de la misma ra�z.</span></li>
              <li><b>En medio � exporta en lote</b><span>Este bot�n exporta todas las publicaciones no archivadas que tengan medios y al menos un destino cuyo estado no sea Publicado ni No aplica. Crea el cat�logo en <code>pc-outbox/catalog.json</code> y organiza los medios bajo <code>pc-outbox/publications/</code>; la app Android las muestra por destino.</span></li>
              <li><b>Final � devuelve confirmaciones</b><span>Marca un destino como usado en Android. La app crea <code>android-inbox/&lt;dispositivo&gt;/</code>; Syncthing lo replica al PC y puedes pulsar <strong>Importar confirmaciones</strong>.</span></li>
            </ol>
            <dl className="path-list"><div><dt>Ra�z compartida en este PC</dt><dd>{mobileFolder || 'Sin configurar'}</dd></div></dl>
            <div className="settings-actions">
              <button className="settings-button" disabled={mobileBusy} onClick={() => void chooseMobileFolder()}><FolderOpen size={15} /> Elegir carpeta ra�z</button>
              <button className="settings-button primary" disabled={mobileBusy} onClick={() => void exportMobileCatalog()}><Download size={15} /> Exportar todas las publicaciones</button>
              <button className="settings-button" disabled={mobileBusy || !mobileFolder} onClick={() => void importMobileEvents()}><RefreshCw size={15} /> Importar confirmaciones</button>
            </div>
            {mobileMessage && <p className="settings-note success" role="status">{mobileMessage}</p>}
            {mobileExportReport?.skipped.length ? <div className="release-notes">
              <strong>Publicaciones omitidas</strong>
              {mobileExportReport.skipped.map(item => <p key={item.postId}>{item.title || item.postId}: {item.reason}</p>)}
            </div> : null}
            {mobileExportReport && (mobileExportReport.missingAlbums.length > 0 || mobileExportReport.catalogBackupPaths.length > 0) ? <div className="release-notes">
              <strong>Revisi�n del cat�logo antes de exportar</strong>
              {mobileExportReport.missingAlbums.map(folder => <p key={folder}>{folder}: referencia retirada; se volver� a preparar si la publicaci�n sigue elegible.</p>)}
              {mobileExportReport.catalogBackupPaths.map(path => <p key={path}>Copia previa guardada: {path}</p>)}
            </div> : null}
            {mobileReport && (mobileReport.invalid.length > 0 || mobileReport.unknown.length > 0 || mobileReport.missingAlbums.length > 0 || mobileReport.catalogBackupPaths.length > 0) && <div className="release-notes">
              <strong>Eventos que requieren atenci�n</strong>
              {mobileReport.invalid.map(item => <p key={item.file}>{item.file}: {item.reason}</p>)}
              {mobileReport.unknown.map(item => <p key={item.file}>{item.file}: no existe la publicaci�n/destino {item.postId} / {item.targetId}.</p>)}
              {mobileReport.missingAlbums.map(folder => <p key={folder}>{folder}: carpeta ausente en pc-outbox/publications; se quit� del cat�logo.</p>)}
              {mobileReport.catalogBackupPaths.map(path => <p key={path}>Cat�logo anterior guardado en: {path}</p>)}
            </div>}
            <section className="mobile-history" aria-labelledby="mobile-history-title">
              <header className="mobile-history-heading">
                <div><strong id="mobile-history-title">Historial de actividad m�vil</strong><small>{mobileHistory.length ? `${mobileHistory.length} ${mobileHistory.length === 1 ? 'evento reciente' : 'eventos recientes'}` : 'Actividad recibida desde el m�vil'}</small></div>
                <button type="button" className="settings-button mobile-history-refresh" disabled={mobileHistoryBusy} onClick={() => void refreshMobileHistory()} aria-label="Actualizar historial m�vil">
                  <RefreshCw size={13} className={mobileHistoryBusy ? 'mobile-history-spinning' : ''} /> Actualizar
                </button>
              </header>
              {mobileHistory.length === 0 && <p className="mobile-history-empty">Todav�a no hay eventos importados. Cuando importes confirmaciones del m�vil, aparecer�n aqu�.</p>}
              {mobileHistory.length > 0 && <ol className="mobile-history-list">
                {mobileHistory.map(event => {
                  const actionLabel = event.action === 'removed' ? 'Retirada del m�vil' : event.action === 'folder_missing' ? 'Carpeta ausente' : 'Marcada como usada'
                  const date = new Date(event.usedAt)
                  const validDate = !Number.isNaN(date.getTime())
                  return <li className="mobile-history-row" key={event.eventId}>
                    <div className="mobile-history-event">
                      <div className="mobile-history-event-top"><span className={`mobile-history-action ${event.action}`}>{actionLabel}</span><b>{event.postTitle || event.postId}</b></div>
                      <small>{event.targetName || event.targetId || 'Sin destino'}<span aria-hidden="true"> � </span><code>{event.postId}</code></small>
                      {event.deviceId && <small className="mobile-history-device"><Smartphone size={11} aria-hidden="true" /> {event.deviceId}</small>}
                      {event.action === 'folder_missing' && event.reason && <small className="mobile-history-reason">{event.reason}</small>}
                    </div>
                    <time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toLocaleString() : undefined}>{validDate ? date.toLocaleString() : 'Fecha desconocida'}</time>
                  </li>
                })}
              </ol>}
            </section>
            <p className="settings-note">�Usada� confirma una acci�n de la persona, no una publicaci�n en redes; importar no cambia estados editoriales.</p>
          </div>
        </details>
      </section>
    {catalogPreview && <div className="catalog-preview-backdrop" role="presentation" onClick={() => setCatalogPreview(null)}>
      <section className="catalog-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-preview-title" onClick={event => event.stopPropagation()}>
        <header><div><h2 id="catalog-preview-title">{catalogPreview.path.includes('catalog-history') ? 'Copia archivada del cat�logo' : 'Cat�logo m�vil actual'}</h2><small>{catalogPreview.path}</small></div><button className="settings-button" onClick={() => setCatalogPreview(null)}>Cerrar</button></header>
        <pre>{catalogPreview.text}</pre>
      </section>
    </div>}
  </>
}

