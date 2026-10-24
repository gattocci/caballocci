import { create } from 'zustand'

export interface AppErrorNotice {
  id: number
  message: string
  createdAt: number
}

interface AppErrorState {
  errors: AppErrorNotice[]
  report(error: unknown, context?: string): void
  dismiss(id: number): void
  clear(): void
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Ocurrió un error inesperado.'
}

export const useAppErrors = create<AppErrorState>(set => ({
  errors: [],
  report: (error, context) => {
    const message = [context, describeError(error)].filter(Boolean).join(': ')
    set(state => ({
      errors: [...state.errors.filter(item => item.message !== message), {
        id: Date.now() + Math.random(),
        message,
        createdAt: Date.now(),
      }].slice(-4),
    }))
  },
  dismiss: id => set(state => ({ errors: state.errors.filter(error => error.id !== id) })),
  clear: () => set({ errors: [] }),
}))

export function reportAppError(error: unknown, context?: string) {
  useAppErrors.getState().report(error, context)
}

export async function runWithErrorReporting<T>(action: () => Promise<T>, context: string): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    reportAppError(error, context)
    return undefined
  }
}
