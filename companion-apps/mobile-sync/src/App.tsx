import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { formatVersion, parseCatalog, usageSchema, type Catalog, type Publication, type UsageEvent } from './contract'
import { SyncFolder } from './native'

const catalogPath = 'pc-outbox/catalog.json'
const deliveredStorageKey = 'caballocci.delivered-events'
const videoExtensions = ['mp4', 'mov', 'm4v', 'webm']
type DisplayMedia = { path: string; kind: 'image' | 'video'; order: number }
type PublicationDisplay = { title: string; media: DisplayMedia[] }
type Album = { publication: Publication; key: string; prefix: string; slug: string; space: string; order: number; index: number }

const pubKey = (publication: { postId: string; targetId: string }) => `${publication.postId}:${publication.targetId}`
const albumFolder = (publication: Publication) => publication.manifestPath.split('/').slice(-2, -1)[0] || publication.postId

function safeRelativePath(value: string) {
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('El snapshot contiene una ruta de archivo no segura.')
  }
  return path
}

/** El escritorio nombra cada carpeta `<lote>-<espacio>-<orden>-<titulo>[-listo]-<fecha>`. */
function parseAlbum(publication: Publication, index: number): Album {
  const folder = albumFolder(publication)
  const key = pubKey(publication)
  const batch = publication.batch
  if (batch && folder.startsWith(`${batch}-`)) {
    const match = folder.slice(batch.length + 1).match(/^(.+?)-(\d+)-(.*)$/)
    if (match) {
      const slug = match[3]!.replace(/-(?:sin-fecha|\d{4}-\d{2}-\d{2}_\d{4}).*$/, '').replace(/-listo$/, '')
      return { publication, key, prefix: `${batch}-${match[1]}-${match[2]}`, slug, space: match[1]!, order: Number(match[2]), index }
    }
  }
  return { publication, key, prefix: '', slug: folder, space: '', order: Number.POSITIVE_INFINITY, index }
}

/** Orden en que se van pasando: por espacio (según aparece en el catálogo) y luego por ordinal. */
function sortAlbums(publications: Publication[]) {
  const albums = publications.map(parseAlbum)
  const spaceRank = new Map<string, number>()
  for (const album of albums) if (album.space && !spaceRank.has(album.space)) spaceRank.set(album.space, spaceRank.size)
  return albums.sort((a, b) =>
    (spaceRank.get(a.space) ?? Number.MAX_SAFE_INTEGER) - (spaceRank.get(b.space) ?? Number.MAX_SAFE_INTEGER) ||
    a.order - b.order || a.index - b.index)
}

function summarizeUsage(events: UsageEvent[]) {
  const used = new Set<string>()
  const latest = new Map<string, { action: string; at: number }>()
  for (const event of events) {
    const key = pubKey(event)
    const at = Date.parse(event.usedAt)
    if (event.action === 'used') used.add(key)
    const previous = latest.get(key)
    if (!previous || at > previous.at || (at === previous.at && event.action === 'removed')) latest.set(key, { action: event.action, at })
  }
  const removed = new Set<string>()
  for (const [key, value] of latest) if (value.action === 'removed') removed.add(key)
  return { used, removed }
}

function destinationBadge(publication: Publication) {
  const known: Record<string, string> = { instagram: 'IG', facebook: 'FB', x: 'X', twitter: 'X', tiktok: 'TT', youtube: 'YT', threads: 'TH' }
  return known[publication.targetId.toLowerCase()] || publication.targetName.slice(0, 2).toUpperCase()
}

function downscale(dataUrl: string, max = 360): Promise<string> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return resolve(dataUrl)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.72))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

function readDelivered() {
  try {
    const parsed = JSON.parse(localStorage.getItem(deliveredStorageKey) || '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

async function deviceId() {
  return (await SyncFolder.getDeviceId()).deviceId
}

async function loadEvents(): Promise<UsageEvent[]> {
  const stored = await SyncFolder.listLocalEvents()
  return stored.events.map(value => JSON.parse(value) as UsageEvent)
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [localEventsLoaded, setLocalEventsLoaded] = useState(false)
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, string>>({})
  const [displays, setDisplays] = useState<Record<string, PublicationDisplay>>({})
  const [loadedPublications, setLoadedPublications] = useState<Record<string, boolean>>({})
  const [folderAvailability, setFolderAvailability] = useState<Record<string, { folder: boolean; manifest: boolean }>>({})
  const [folderCheckFailed, setFolderCheckFailed] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [folderReady, setFolderReady] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbsRequested = useRef(new Set<string>())
  const catalogStamp = useRef('')
  const deliveredRef = useRef<Set<string>>(readDelivered())
  const [, setDeliveredTick] = useState(0)
  const toastTimer = useRef<number | undefined>(undefined)

  // Los avisos desaparecen solos: los informativos a los pocos segundos, los errores un poco después (o al tocarlos).
  const notify = useCallback((text: string, error = false) => {
    window.clearTimeout(toastTimer.current)
    if (!text) { setToast(null); return }
    setToast({ text, error })
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 9000 : 3500)
  }, [])
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

  const markDelivered = (eventId: string) => {
    deliveredRef.current.add(eventId)
    try { localStorage.setItem(deliveredStorageKey, JSON.stringify([...deliveredRef.current])) } catch { /* el reintento seguirá siendo seguro */ }
    setDeliveredTick(value => value + 1)
  }

  const refreshCatalog = useCallback(async () => {
    setBusy(true)
    notify('')
    try {
      const raw = await SyncFolder.readText({ path: catalogPath })
      const loaded = parseCatalog(JSON.parse(raw.text) as unknown)
      const manifestPaths = [...new Set(loaded.publications.map(publication => publication.manifestPath))]
      setFolderAvailability({})
      setFolderCheckFailed(false)
      void Promise.all(manifestPaths.map(async path => {
        const directoryPath = path.split('/').slice(0, -1).join('/')
        const [folderResult, manifestResult] = await Promise.all([
          SyncFolder.exists({ path: safeRelativePath(directoryPath) }),
          SyncFolder.exists({ path: safeRelativePath(path) }),
        ])
        return [path, { folder: folderResult.exists, manifest: manifestResult.exists }] as const
      })).then(results => setFolderAvailability(Object.fromEntries(results)))
        .catch(error => {
          setFolderCheckFailed(true)
          notify(errorText(error, 'No se pudo comprobar qué carpetas están sincronizadas.'), true)
        })
      const storedEvents = await loadEvents()
      if (loaded.generatedAt !== catalogStamp.current) {
        catalogStamp.current = loaded.generatedAt
        setThumbs({})
        thumbsRequested.current = new Set()
      }
      setCatalog(loaded)
      setEvents(storedEvents)
      setDisplays({})
      setCaptions({})
      setImages({})
      setLoadedPublications({})
      setOpenKey(null)
      setFolderReady(true)
      notify(`Snapshot leído (${loaded.publications.length} destinos).`)
    } catch (error) {
      notify(errorText(error, 'No se pudo leer el snapshot.'), true)
    } finally {
      setBusy(false)
    }
  }, [notify])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      notify('Abre esta aplicación en Android para acceder a la carpeta compartida.', true)
      return
    }
    void loadEvents()
      .then(setEvents)
      .catch(error => notify(errorText(error, 'No se pudieron recuperar los eventos locales.'), true))
      .finally(() => setLocalEventsLoaded(true))
    void SyncFolder.hasFolder().then(result => {
      setFolderReady(result.selected)
      if (result.selected) void refreshCatalog()
    }).catch(error => notify(errorText(error, 'No se pudo consultar el permiso de carpeta.'), true))
  }, [refreshCatalog, notify])

  const usage = useMemo(() => summarizeUsage(events), [events])
  const isUsed = useCallback((publication: Publication) => publication.used || usage.used.has(pubKey(publication)), [usage])
  // Lo retirado desde el móvil no se muestra, aunque la PC todavía no haya importado el retiro.
  const albums = useMemo(
    () => sortAlbums((catalog?.publications || []).filter(publication => !usage.removed.has(pubKey(publication)))),
    [catalog, usage],
  )
  const destinations = useMemo(() => {
    const seen = new Map<string, string>()
    for (const album of albums) if (!seen.has(album.publication.targetId)) seen.set(album.publication.targetId, album.publication.targetName)
    return [...seen]
  }, [albums])
  const activeFilter = destinations.some(([id]) => id === filter) ? filter : 'all'
  const shown = useMemo(() => activeFilter === 'all' ? albums : albums.filter(album => album.publication.targetId === activeFilter), [albums, activeFilter])
  const usedShown = shown.filter(album => isUsed(album.publication))
  const pendingCount = albums.filter(album => !isUsed(album.publication)).length
  const referencedAlbums = useMemo(() => [...new Set((catalog?.publications || []).map(publication => publication.manifestPath))], [catalog])
  const missingAlbumPaths = referencedAlbums.filter(path => folderAvailability[path]?.folder === false)
  const incompleteAlbumPaths = referencedAlbums.filter(path => folderAvailability[path]?.folder === true && folderAvailability[path]?.manifest === false)
  const problemAlbumPaths = [...missingAlbumPaths, ...incompleteAlbumPaths]
  const availableAlbumCount = referencedAlbums.filter(path => folderAvailability[path]?.folder === true).length
  const folderCheckComplete = !folderCheckFailed && referencedAlbums.every(path => folderAvailability[path] !== undefined)
  const missingPublications = (catalog?.publications || []).filter(publication => missingAlbumPaths.includes(publication.manifestPath))
  const missingUnsignaledPublications = missingPublications.filter(publication => !usage.removed.has(pubKey(publication)))
  const current: Publication | undefined = albums.find(album => album.key === openKey)?.publication
  const currentIndex = shown.findIndex(album => album.key === openKey)
  const undelivered = events.filter(event => !deliveredRef.current.has(event.eventId))

  // Miniaturas: la portada es la primera imagen del manifest (el orden de llegada); un álbum se lee una sola vez
  // aunque tenga varios destinos.
  useEffect(() => {
    if (!catalog) return
    let active = true
    let failures = 0
    const queue = [...new Map(catalog.publications
      .filter(publication => !thumbsRequested.current.has(publication.manifestPath))
      .sort((a, b) => Number(a.used) - Number(b.used))
      .map(publication => [publication.manifestPath, publication])).values()]
    queue.forEach(publication => thumbsRequested.current.add(publication.manifestPath))
    const worker = async () => {
      for (let publication = queue.shift(); publication && active; publication = queue.shift()) {
        try {
          const manifestResult = await SyncFolder.readText({ path: safeRelativePath(publication.manifestPath) })
          const manifest = JSON.parse(manifestResult.text) as { files?: unknown }
          const files = Array.isArray(manifest.files) ? manifest.files.filter((file): file is string => typeof file === 'string') : []
          const cover = files.find(file => !videoExtensions.includes(file.split('.').pop()?.toLowerCase() || ''))
          if (!cover || cover.includes('/') || cover.includes('\\') || cover === '.' || cover === '..') continue
          const directory = publication.manifestPath.split('/').slice(0, -1).join('/')
          const result = await SyncFolder.readMedia({ path: safeRelativePath(`${directory}/${cover}`) })
          const src = await downscale(`data:${result.mimeType};base64,${result.data}`)
          if (active) setThumbs(value => ({ ...value, [publication!.manifestPath]: src }))
        } catch {
          failures += 1
          thumbsRequested.current.delete(publication.manifestPath)
        }
      }
    }
    void Promise.all([worker(), worker()]).then(() => {
      if (active && failures) notify(`No se pudieron leer ${failures} portada${failures === 1 ? '' : 's'}. Actualiza el snapshot cuando Syncthing termine.`, true)
    })
    return () => {
      active = false
      queue.forEach(publication => thumbsRequested.current.delete(publication.manifestPath))
    }
  }, [catalog, notify])

  useEffect(() => {
    if (!current) return
    let active = true
    const key = pubKey(current)
    const loadAssets = async () => {
      let mediaForDisplay: DisplayMedia[] = []
      let allAssetsLoaded = true
      try {
        const manifestResult = await SyncFolder.readText({ path: safeRelativePath(current.manifestPath) })
        const manifest: unknown = JSON.parse(manifestResult.text)
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('El manifest de medios no es válido.')
        const manifestRecord = manifest as Record<string, unknown>
        if (manifestRecord.postId !== current.postId || typeof manifestRecord.title !== 'string' ||
          !Array.isArray(manifestRecord.files) || manifestRecord.files.some(file => typeof file !== 'string')) {
          throw new Error('El manifest no coincide con la publicación del snapshot.')
        }
        const directory = current.manifestPath.split('/').slice(0, -1).join('/')
        mediaForDisplay = (manifestRecord.files as string[]).map((file, order) => {
          if (!file || file.includes('/') || file.includes('\\') || file === '.' || file === '..') {
            throw new Error('El manifest contiene un nombre de medio no válido.')
          }
          const path = `${directory}/${file}`
          const extension = file.split('.').pop()?.toLowerCase() || ''
          const kind: DisplayMedia['kind'] = videoExtensions.includes(extension) ? 'video' : 'image'
          return { path, kind, order }
        })
        if (active) setDisplays(value => ({ ...value, [key]: { title: manifestRecord.title as string, media: mediaForDisplay } }))
        const caption = await SyncFolder.readText({ path: safeRelativePath(current.captionPath) })
        if (active) setCaptions(value => ({ ...value, [key]: caption.text }))
      } catch (error) {
        allAssetsLoaded = false
        if (active) notify(errorText(error, 'No se pudo leer el texto de la publicación.'), true)
      }
      for (const media of mediaForDisplay) {
        if (media.kind !== 'image') continue
        const imageKey = `${key}:${media.order}`
        try {
          const result = await SyncFolder.readMedia({ path: safeRelativePath(media.path) })
          if (active) setImages(value => ({ ...value, [imageKey]: `data:${result.mimeType};base64,${result.data}` }))
        } catch (error) {
          allAssetsLoaded = false
          if (active) notify(errorText(error, 'No se pudo leer una imagen.'), true)
        }
      }
      if (active && allAssetsLoaded) setLoadedPublications(value => ({ ...value, [key]: true }))
    }
    void loadAssets()
    return () => { active = false }
  }, [current, notify])

  const chooseFolder = async () => {
    setBusy(true)
    notify('')
    try {
      await SyncFolder.chooseFolder()
      setFolderReady(true)
      await refreshCatalog()
    } catch (error) {
      notify(errorText(error, 'No se pudo seleccionar la carpeta compartida.'), true)
    } finally {
      setBusy(false)
    }
  }

  const deliver = async (event: UsageEvent) => {
    await SyncFolder.writeEvent({
      deviceId: event.deviceId,
      eventId: event.eventId,
      content: JSON.stringify(event, null, 2),
    })
    markDelivered(event.eventId)
  }

  /** Guarda el evento en el teléfono (obligatorio) y lo entrega a Syncthing (reintentable). */
  const recordEvent = async (publication: Publication, action: UsageEvent['action']) => {
    const event: UsageEvent = {
      schema: usageSchema,
      version: formatVersion,
      eventId: crypto.randomUUID(),
      postId: publication.postId,
      targetId: publication.targetId,
      action,
      usedAt: new Date().toISOString(),
      deviceId: await deviceId(),
    }
    await SyncFolder.storeEvent({
      deviceId: event.deviceId,
      eventId: event.eventId,
      content: JSON.stringify(event, null, 2),
    })
    setEvents(value => [...value, event])
    try {
      await deliver(event)
      return true
    } catch {
      return false
    }
  }

  const markUsed = async () => {
    if (!current) return
    setBusy(true)
    try {
      const delivered = await recordEvent(current, 'used')
      setOpenKey(null)
      notify(delivered ? 'Marcada como usada.' : 'Marcada en este teléfono; falta entregarla a Syncthing (se reintentará).', !delivered)
    } catch (error) {
      notify(`No se pudo guardar la confirmación local: ${errorText(error, 'error de almacenamiento')}`, true)
    } finally {
      setBusy(false)
    }
  }

  const removeFromPhone = async (targets: Publication[], deleteWholeAlbums = false) => {
    if (!targets.length) return
    setBusy(true)
    let done = 0
    let pendingDelivery = 0
    let albumsDeleted = 0
    let albumDeleteFailed = false
    try {
      const uniqueTargets = [...new Map(targets.map(publication => [pubKey(publication), publication])).values()]
      for (const publication of uniqueTargets) {
        if (!(await recordEvent(publication, 'removed'))) pendingDelivery += 1
        done += 1
      }
      const selectedKeys = new Set(uniqueTargets.map(pubKey))
      const folders = new Map<string, Publication>()
      for (const publication of uniqueTargets) folders.set(albumFolder(publication), publication)
      if (deleteWholeAlbums) {
        for (const [folder, publication] of folders) {
          const albumTargets = catalog?.publications.filter(item => item.manifestPath === publication.manifestPath) || [publication]
          if (!albumTargets.every(item => selectedKeys.has(pubKey(item)))) continue
          try {
            const result = await SyncFolder.deleteAlbum({ path: safeRelativePath(`pc-outbox/publications/${folder}`) })
            if (result.deleted) albumsDeleted += 1
          } catch {
            albumDeleteFailed = true
          }
        }
      }
      setOpenKey(null)
      const message = `${done} destino${done === 1 ? '' : 's'} retirado${done === 1 ? '' : 's'} del móvil.${albumsDeleted ? ` ${albumsDeleted} álbum${albumsDeleted === 1 ? '' : 'es'} borrado${albumsDeleted === 1 ? '' : 's'} del teléfono.` : ''}${albumDeleteFailed ? ' No se pudo borrar una carpeta; la PC la retirará al recibir la señal.' : ''}${pendingDelivery ? ' Las señales se reintentarán cuando Syncthing esté disponible.' : ''}`
      notify(message, pendingDelivery > 0 || albumDeleteFailed)
    } catch (error) {
      notify(`${done ? `Se retiraron ${done}. ` : ''}No se pudo continuar: ${errorText(error, 'error de almacenamiento')}`, true)
    } finally {
      setBusy(false)
    }
  }
  const cleanUsed = () => {
    const targets = usedShown.map(album => album.publication)
    if (!targets.length) return
    if (window.confirm(`¿Quitar ${targets.length} publicaci${targets.length === 1 ? 'ón lista' : 'ones listas'} del móvil? Quedan registradas en el historial de la PC.`)) {
      void removeFromPhone(targets, true)
    }
  }

  const deleteAlbum = (publication: Publication) => {
    const targets = catalog?.publications.filter(item => item.manifestPath === publication.manifestPath) || [publication]
    if (!window.confirm(`¿Borrar el álbum “${albumFolder(publication)}” del almacenamiento del teléfono? Se retirarán ${targets.length} destino${targets.length === 1 ? '' : 's'} y el orden de los demás álbumes no cambiará.`)) return
    void removeFromPhone(targets, true)
  }
  const retireMissingAlbums = () => {
    if (!catalog || !missingUnsignaledPublications.length) return
    const targets = missingUnsignaledPublications
    if (!window.confirm(`Hay ${problemAlbumPaths.length} álbumes con carpetas o manifiestos faltantes. Enviar señales para retirar ${targets.length} destinos y pedir a la PC que archive y reconcilie el catálogo?`)) return
    void removeFromPhone(targets, true)
  }

  const retryPending = useCallback(async () => {
    setBusy(true)
    try {
      const stored = (await loadEvents()).filter(event => !deliveredRef.current.has(event.eventId))
      let failed = 0
      for (const event of stored) {
        try {
          await deliver(event)
        } catch {
          failed += 1
        }
      }
      if (stored.length) notify(failed ? `${failed} evento${failed === 1 ? '' : 's'} sigue${failed === 1 ? '' : 'n'} pendiente${failed === 1 ? '' : 's'}.` : 'Eventos entregados a Syncthing.', failed > 0)
    } catch (error) {
      notify(errorText(error, 'No se pudieron recuperar los eventos locales.'), true)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify])
  const startupRetryDone = useRef(false)
  useEffect(() => {
    if (!folderReady || !localEventsLoaded || startupRetryDone.current) return
    startupRetryDone.current = true
    if (events.some(event => !deliveredRef.current.has(event.eventId))) void retryPending()
  }, [events, folderReady, localEventsLoaded, retryPending])

  const currentKey = current ? pubKey(current) : ''
  const currentCaption = captions[currentKey] || ''
  const currentDisplay = displays[currentKey]
  const currentUsed = current ? isUsed(current) : false

  return <main>
    <header><span>CABALLOCci · MÓVIL</span><h1>Publicaciones</h1><p>Confirma el uso por destino. Esto no verifica la publicación externa.</p></header>
    <section className="sync-help"><strong>Cómo funciona</strong><p>“Marcar como usada” solo guarda una confirmación; no publica ni cambia el estado editorial. “Borrar álbum” elimina la carpeta compartida del teléfono y envía una señal a la PC. Syncthing sincroniza ambas cosas; al importar señales, la PC registra el historial, y al conciliar archiva el catálogo antes de actualizarlo y limpiar carpetas. Android no modifica <code>catalog.json</code>.</p></section>
    {!folderReady && <section className="setup"><h2>Conectar carpeta compartida</h2><p>Selecciona una vez la carpeta de Syncthing que contiene <code>pc-outbox</code>. Android solicitará permiso persistente.</p><button disabled={busy || !Capacitor.isNativePlatform()} onClick={() => void chooseFolder()}>{busy ? 'Conectando…' : 'Elegir carpeta Syncthing'}</button>{!Capacitor.isNativePlatform() && <small>El selector nativo está disponible en Android.</small>}</section>}
    {folderReady && <section className="toolbar"><button disabled={busy} onClick={() => void chooseFolder()}>Carpeta Syncthing</button><button disabled={busy} onClick={() => void refreshCatalog()}>Actualizar snapshot</button>{undelivered.length > 0 && <button disabled={busy} onClick={() => void retryPending()}>Reintentar eventos ({undelivered.length})</button>}</section>}
    {catalog && <section className={`catalog-integrity${problemAlbumPaths.length ? ' catalog-integrity-warning' : ''}`}>
      <strong>Catálogo y carpetas</strong>
      {folderCheckFailed
        ? <p>No se pudo comprobar el almacenamiento. Revisa el permiso de la carpeta Syncthing.</p>
        : !folderCheckComplete
          ? <p>Comprobando {referencedAlbums.length} carpetas referenciadas…</p>
          : <p>{catalog.publications.length} destinos en {referencedAlbums.length} carpetas: {availableAlbumCount} presentes, {missingAlbumPaths.length} ausentes y {incompleteAlbumPaths.length} incompletas.</p>}
      {problemAlbumPaths.length > 0 && <>
        <p>Estos destinos siguen en <code>catalog.json</code>, pero falta su carpeta o manifest.json en el almacenamiento sincronizado. Espera a que Syncthing termine o envía una señal para que la PC guarde una copia y retire esas referencias.</p>
        <ul>{problemAlbumPaths.map(path => <li key={path}>{path.split('/').slice(-2, -1)[0]}{incompleteAlbumPaths.includes(path) ? ' · falta manifest.json' : ''}</li>)}</ul>
        {incompleteAlbumPaths.length > 0 && <small>Las carpetas incompletas se dejan intactas mientras Syncthing termina; solo se propondrá retirar carpetas que no existen.</small>}
        {missingUnsignaledPublications.length < missingPublications.length && <small>{missingPublications.length - missingUnsignaledPublications.length} de {missingPublications.length} destinos ya tienen una señal de retiro; falta que la PC sincronice el catálogo.</small>}
        <button className="reconcile-missing" disabled={busy || undelivered.length > 0 || missingUnsignaledPublications.length === 0} onClick={retireMissingAlbums}>{missingUnsignaledPublications.length ? `Enviar retiro a la PC (${missingUnsignaledPublications.length} destinos)` : "Retiro enviado; esperando a la PC"}</button>
        {undelivered.length > 0 && <small>Primero reintenta la entrega de las señales pendientes.</small>}
      </>}
    </section>}
    {catalog && !current && destinations.length > 1 && <nav className="chips" aria-label="Destino">{[['all', 'Todos'], ...destinations].map(([id, name]) => <button key={id} className={id === activeFilter ? 'chip chip-on' : 'chip'} onClick={() => setFilter(id!)}>{name}</button>)}</nav>}
    {catalog && !current && usedShown.length > 0 && <button className="clean" disabled={busy} onClick={cleanUsed}>Quitar listas del móvil ({usedShown.length})</button>}
    {catalog && !current && (shown.length ? <section className="grid" aria-label="Publicaciones">{shown.map(album => {
      const used = isUsed(album.publication)
      const thumb = thumbs[album.publication.manifestPath]
      const folderMissing = folderAvailability[album.publication.manifestPath]?.folder === false
      const manifestMissing = folderAvailability[album.publication.manifestPath]?.folder === true && folderAvailability[album.publication.manifestPath]?.manifest === false
      return <div key={album.key} className="tile-container">
        <button className={`tile${used ? ' tile-used' : ''}${folderMissing || manifestMissing ? ' tile-missing' : ''}`} onClick={() => setOpenKey(album.key)}>
          {thumb && !folderMissing && !manifestMissing && <img src={thumb} alt="" />}
          {folderMissing && <span className="tile-missing-status">CARPETA AUSENTE</span>}
          {manifestMissing && <span className="tile-missing-status">MANIFEST AUSENTE</span>}
          {used && <span className="tile-status">MARCADA LISTA</span>}
          {destinations.length > 1 && <span className="tile-badge">{destinationBadge(album.publication)}</span>}
          <span className="tile-name">{album.prefix && <><b>{album.prefix}</b>-</>}{album.slug}</span>
        </button>
        <button className="tile-delete" disabled={busy} aria-label={`Borrar álbum ${album.slug}`} title="Borrar álbum y su carpeta" onClick={() => deleteAlbum(album.publication)}>×</button>
      </div>
    })}</section> : <section className="empty"><h2>No hay publicaciones</h2><p>Genera un snapshot nuevo desde caballocci después de agregar publicaciones.</p></section>)}
    {current && <article className="publication">
      <div className="detail-bar"><button onClick={() => setOpenKey(null)}>← Volver</button><span>{currentIndex >= 0 ? `${currentIndex + 1} / ${shown.length}` : ''}</span></div>
      <div className="target">{current.targetName}</div>
      {(folderAvailability[current.manifestPath]?.folder === false || folderAvailability[current.manifestPath]?.manifest === false) && <p className="missing-note">Esta publicación sigue referenciada en el catálogo, pero falta su carpeta o manifest.json en este teléfono. Espera la sincronización o bórrala para avisar a la PC.</p>}
      {currentUsed
        ? <button className="remove" disabled={busy} onClick={() => void removeFromPhone([current])}>Quitar del móvil</button>
        : <button className="used" disabled={busy || !loadedPublications[currentKey]} onClick={() => void markUsed()}>{loadedPublications[currentKey] ? 'Marcar como usada' : 'Preparando publicación…'}</button>}
      <button className="remove-album" disabled={busy} onClick={() => deleteAlbum(current)}>Borrar álbum y carpeta del teléfono</button>
      <details key={currentKey} className="publication-details">
        <summary>Ver contenido de la publicación</summary>
        <h2>{currentDisplay?.title || 'Publicación sin título'}</h2>
        {current.scheduledAt && <small>Programada: {new Date(current.scheduledAt).toLocaleString()}</small>}
        <div className="gallery">{(currentDisplay?.media || []).filter(media => media.kind === 'image').map(media => {
          const src = images[`${currentKey}:${media.order}`]
          return src ? <img key={media.path} src={src} alt={`${currentDisplay?.title || current.postId} · imagen ${media.order + 1}`} /> : <div className="image-placeholder" key={media.path}>Cargando imagen {media.order + 1}…</div>
        })}</div>
        {currentDisplay && !currentDisplay.media.some(media => media.kind === 'image') && <p>No hay imágenes en esta publicación. Los videos no se muestran en esta versión.</p>}
        {currentCaption && <pre>{currentCaption}</pre>}
      </details>
      <div className="pagination"><button disabled={currentIndex <= 0} onClick={() => setOpenKey(shown[currentIndex - 1]!.key)}>Anterior</button><span>{pendingCount} pendientes</span><button disabled={currentIndex < 0 || currentIndex >= shown.length - 1} onClick={() => setOpenKey(shown[currentIndex + 1]!.key)}>Siguiente</button></div>
    </article>}
    {toast && <p className={`message${toast.error ? ' message-error' : ''}`} role="status" onClick={() => notify('')}>{toast.text}</p>}
  </main>
}
