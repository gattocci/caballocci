import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { formatVersion, parseCatalog, usageSchema, type Catalog, type Publication, type UsageEvent } from './contract'
import { SyncFolder } from './native'

const catalogPath = 'pc-outbox/catalog.json'
type DisplayMedia = { path: string; kind: 'image' | 'video'; order: number }
type PublicationDisplay = { title: string; media: DisplayMedia[] }

function safeRelativePath(value: string) {
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('El snapshot contiene una ruta de archivo no segura.')
  }
  return path
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
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [folderReady, setFolderReady] = useState(false)
  const [selected, setSelected] = useState(0)

  const refreshCatalog = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const raw = await SyncFolder.readText({ path: catalogPath })
      const loaded = parseCatalog(JSON.parse(raw.text) as unknown)
      const storedEvents = await loadEvents()
      setCatalog(loaded)
      setEvents(storedEvents)
      setDisplays({})
      setCaptions({})
      setImages({})
      setLoadedPublications({})
      setFolderReady(true)
      setMessage(`Snapshot leído (${loaded.publications.length} destinos).`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo leer el snapshot.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setMessage('Abre esta aplicación en Android para acceder a la carpeta compartida.')
      return
    }
    void loadEvents()
      .then(setEvents)
      .catch(error => setMessage(error instanceof Error ? error.message : 'No se pudieron recuperar los eventos locales.'))
      .finally(() => setLocalEventsLoaded(true))
    void SyncFolder.hasFolder().then(result => {
      setFolderReady(result.selected)
      if (result.selected) void refreshCatalog()
    }).catch(error => setMessage(error instanceof Error ? error.message : 'No se pudo consultar el permiso de carpeta.'))
  }, [refreshCatalog])

  const pending = useMemo(() => {
    const locallyUsed = new Set(events.map(event => `${event.postId}\u0000${event.targetId}`))
    return (catalog?.publications || []).filter(publication =>
      !publication.used && !locallyUsed.has(`${publication.postId}\u0000${publication.targetId}`),
    )
  }, [catalog, events])
  const current: Publication | undefined = pending[Math.min(selected, Math.max(0, pending.length - 1))]

  useEffect(() => {
    if (!current) return
    let active = true
    const key = `${current.postId}:${current.targetId}`
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
          const kind: DisplayMedia['kind'] = ['mp4', 'mov', 'm4v', 'webm'].includes(extension) ? 'video' : 'image'
          return { path, kind, order }
        })
        if (active) setDisplays(value => ({ ...value, [key]: { title: manifestRecord.title as string, media: mediaForDisplay } }))
        const caption = await SyncFolder.readText({ path: safeRelativePath(current.captionPath) })
        if (active) setCaptions(value => ({ ...value, [key]: caption.text }))
      } catch (error) {
        allAssetsLoaded = false
        if (active) setMessage(error instanceof Error ? error.message : 'No se pudo leer el texto de la publicación.')
      }
      for (const media of mediaForDisplay) {
        if (media.kind !== 'image') continue
        const imageKey = `${key}:${media.order}`
        try {
          const result = await SyncFolder.readMedia({ path: safeRelativePath(media.path) })
          if (active) setImages(value => ({ ...value, [imageKey]: `data:${result.mimeType};base64,${result.data}` }))
        } catch (error) {
          allAssetsLoaded = false
          if (active) setMessage(error instanceof Error ? error.message : 'No se pudo leer una imagen.')
        }
      }
      if (active && allAssetsLoaded) setLoadedPublications(value => ({ ...value, [key]: true }))
    }
    void loadAssets()
    return () => { active = false }
  }, [current])

  const chooseFolder = async () => {
    setBusy(true)
    setMessage('')
    try {
      await SyncFolder.chooseFolder()
      setFolderReady(true)
      await refreshCatalog()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo seleccionar la carpeta compartida.')
    } finally {
      setBusy(false)
    }
  }

  const persistEvent = async (event: UsageEvent, next: UsageEvent[]) => {
    await SyncFolder.storeEvent({
      deviceId: event.deviceId,
      eventId: event.eventId,
      content: JSON.stringify(event, null, 2),
    })
    setEvents(next)
  }

  const syncEvent = async (event: UsageEvent) => {
    await SyncFolder.writeEvent({
      deviceId: event.deviceId,
      eventId: event.eventId,
      content: JSON.stringify(event, null, 2),
    })
  }

  const markUsed = async () => {
    if (!current) return
    setBusy(true)
    try {
      const event: UsageEvent = {
        schema: usageSchema,
        version: formatVersion,
        eventId: crypto.randomUUID(),
        postId: current.postId,
        targetId: current.targetId,
        action: 'used',
        usedAt: new Date().toISOString(),
        deviceId: await deviceId(),
      }
      const next = [...events, event]
      await persistEvent(event, next)
      setMessage('Confirmación guardada en este dispositivo.')
      try {
        await syncEvent(event)
        setMessage('Confirmación guardada y entregada a Syncthing.')
      } catch (error) {
        setMessage(`Confirmación conservada localmente; no se pudo escribir en la carpeta compartida: ${error instanceof Error ? error.message : 'error de almacenamiento'}`)
      }
    } catch (error) {
      setMessage(`No se pudo guardar la confirmación local: ${error instanceof Error ? error.message : 'error de almacenamiento'}`)
    } finally {
      setBusy(false)
    }
  }

  const retryPending = useCallback(async () => {
    setBusy(true)
    try {
      const stored = await loadEvents()
      let failed = 0
      for (const event of stored) {
        try {
          await syncEvent(event)
        } catch {
          failed += 1
        }
      }
      setEvents(stored)
      setMessage(failed ? `Se reintentaron los eventos; ${failed} siguen pendientes.` : 'Eventos locales reintentados; Syncthing puede sincronizarlos.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron recuperar los eventos locales.')
    } finally {
      setBusy(false)
    }
  }, [])
  const startupRetryDone = useRef(false)
  useEffect(() => {
    if (!folderReady || !localEventsLoaded || startupRetryDone.current) return
    startupRetryDone.current = true
    if (events.length) void retryPending()
  }, [events.length, folderReady, localEventsLoaded, retryPending])

  const currentKey = current ? `${current.postId}:${current.targetId}` : ''
  const currentCaption = captions[currentKey] || ''
  const currentDisplay = displays[currentKey]

  return <main>
    <header><span>CABALLOCci · MÓVIL</span><h1>Publicaciones</h1><p>Confirma el uso por destino. Esto no verifica la publicación externa.</p></header>
    {!folderReady && <section className="setup"><h2>Conectar carpeta compartida</h2><p>Selecciona una vez la carpeta de Syncthing que contiene <code>pc-outbox</code>. Android solicitará permiso persistente.</p><button disabled={busy || !Capacitor.isNativePlatform()} onClick={() => void chooseFolder()}>{busy ? 'Conectando…' : 'Elegir carpeta Syncthing'}</button>{!Capacitor.isNativePlatform() && <small>El selector nativo está disponible en Android.</small>}</section>}
    {folderReady && <section className="toolbar"><button disabled={busy} onClick={() => void chooseFolder()}>Carpeta Syncthing</button><button disabled={busy} onClick={() => void refreshCatalog()}>Actualizar snapshot</button><button disabled={busy} onClick={() => void retryPending()}>Reintentar eventos ({events.length})</button></section>}
    {current && <article className="publication">
      <div className="target">{current.targetName}</div>
      <h2>{currentDisplay?.title || 'Publicación sin título'}</h2>
      {current.scheduledAt && <small>Programada: {new Date(current.scheduledAt).toLocaleString()}</small>}
      <div className="gallery">{(currentDisplay?.media || []).filter(media => media.kind === 'image').map(media => {
        const src = images[`${currentKey}:${media.order}`]
        return src ? <img key={media.path} src={src} alt={`${currentDisplay?.title || current.postId} · imagen ${media.order + 1}`} /> : <div className="image-placeholder" key={media.path}>Cargando imagen {media.order + 1}…</div>
      })}</div>
      {currentDisplay && !currentDisplay.media.some(media => media.kind === 'image') && <p>No hay imágenes en esta publicación. Los videos no se muestran en esta versión.</p>}
      {currentCaption && <pre>{currentCaption}</pre>}
      <button className="used" disabled={busy || !loadedPublications[currentKey]} onClick={() => void markUsed()}>{loadedPublications[currentKey] ? 'Marcar como usada' : 'Preparando publicación…'}</button>
      {pending.length > 1 && <div className="pagination"><button disabled={selected === 0} onClick={() => setSelected(index => Math.max(0, index - 1))}>Anterior</button><span>{Math.min(selected + 1, pending.length)} / {pending.length}</span><button disabled={selected >= pending.length - 1} onClick={() => setSelected(index => Math.min(pending.length - 1, index + 1))}>Siguiente</button></div>}
    </article>}
    {catalog && !current && <section className="empty"><h2>No hay destinos pendientes</h2><p>Genera un snapshot nuevo desde caballocci después de agregar publicaciones.</p></section>}
    {message && <p className="message" role="status">{message}</p>}
  </main>
}
