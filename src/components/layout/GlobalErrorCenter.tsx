import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { reportAppError, useAppErrors } from '../../app/errors'

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportAppError(error, 'Error al mostrar esta pantalla')
  }

  render() {
    if (this.state.error) {
      return <div className="loading app-error-fallback">
        <AlertCircle size={28} />
        <strong>Esta pantalla encontró un problema</strong>
        <p>El error quedó registrado en el centro de errores.</p>
        <button type="button" className="save-button" onClick={() => this.setState({ error: null })}>Volver a intentar</button>
      </div>
    }
    return this.props.children
  }
}

export function GlobalErrorCenter() {
  const { errors, dismiss, clear } = useAppErrors()
  if (!errors.length) return null

  return <aside className="global-error-center" aria-label="Centro de errores">
    <header><div><AlertCircle size={17} /><strong>Errores de la aplicación</strong><span>{errors.length}</span></div><button type="button" onClick={clear}>Limpiar</button></header>
    <div className="global-error-list" aria-live="assertive" aria-relevant="additions">
      {errors.map(error => <article key={error.id} role="alert">
        <p>{error.message}</p>
        <small>{new Date(error.createdAt).toLocaleTimeString()}</small>
        <button type="button" aria-label="Cerrar error" onClick={() => dismiss(error.id)}><X size={14} /></button>
      </article>)}
    </div>
  </aside>
}
