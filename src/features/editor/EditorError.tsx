import { X } from 'lucide-react'

export function EditorError({ message, onDismiss }: { message: string; onDismiss(): void }) {
  if (!message) return null

  return <section className="editor-error-banner" role="alert" aria-label="Error de medios">
    <strong>Error de medios</strong>
    <pre>{message}</pre>
    <button type="button" onClick={onDismiss}><X size={13} /> Cerrar aviso</button>
  </section>
}
