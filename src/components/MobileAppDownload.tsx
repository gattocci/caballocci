import { useState } from 'react'
import { AlertCircle, CheckCircle2, Download, LoaderCircle } from 'lucide-react'
import './mobile-app-download.css'

type DownloadState = 'idle' | 'checking' | 'opened' | 'unavailable' | 'error'

export function MobileAppDownload({ className, label = 'Descargar APK' }: { className: string; label?: string }) {
  const [state, setState] = useState<DownloadState>('idle')
  const [message, setMessage] = useState('')

  const openDownload = async () => {
    setState('checking')
    setMessage('Comprobando si el APK está disponible…')
    try {
      const result = await window.planner.system.openMobileAppDownload()
      if (result.available) {
        setState('opened')
        setMessage('Se abrió la descarga en tu navegador. Cuando termine, abre el APK en tu teléfono para instalar la app.')
      } else {
        setState('unavailable')
        setMessage('El APK todavía no está publicado en la última versión de caballocci.')
      }
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'No se pudo comprobar ni abrir la descarga del APK.')
    }
  }

  const busy = state === 'checking'
  const Icon = state === 'checking' ? LoaderCircle : state === 'opened' ? CheckCircle2 : state === 'unavailable' || state === 'error' ? AlertCircle : Download

  return <div className="mobile-apk-download">
    <button type="button" className={className} disabled={busy} onClick={() => void openDownload()}>
      <Icon size={14} className={busy ? 'mobile-apk-spinner' : undefined} />
      {busy ? 'Comprobando APK…' : state === 'opened' ? 'Descargar APK otra vez' : state === 'unavailable' ? 'APK no disponible' : state === 'error' ? 'Reintentar descarga' : label}
    </button>
    {message && <p className={`mobile-apk-feedback ${state}`} role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
  </div>
}
