import { createContext, useContext, useState, useCallback } from 'react'

const ConfirmContext = createContext(null)

// Promise-based replacement for window.confirm() — same call-site ergonomics
// (`if (!(await confirm('...'))) return`) but a real, styled, on-brand modal
// instead of the browser-native dialog. One instance mounted at the app root;
// every destructive action in the app goes through this same component so
// there's exactly one confirmation UX, not three different ones.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)

  const confirm = useCallback((opts) => {
    const normalized = typeof opts === 'string' ? { message: opts } : (opts || {})
    const {
      title = 'Are you sure?',
      message = '',
      confirmLabel = 'Delete',
      cancelLabel = 'Cancel',
      danger = true,
    } = normalized
    return new Promise((resolve) => {
      setState({ title, message, confirmLabel, cancelLabel, danger, resolve })
    })
  }, [])

  const resolve = (result) => {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
          onClick={() => resolve(false)}
        >
          <div
            className="bg-[#2E2E2E] rounded-xl p-5 max-w-sm w-full border border-[#3A3A3A] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-white mb-2">{state.title}</p>
            {state.message && <p className="text-sm text-gray-400 mb-5 whitespace-pre-line">{state.message}</p>}
            <div className="flex justify-end gap-2 mt-1">
              <button
                autoFocus
                onClick={() => resolve(false)}
                className="px-3 py-1.5 rounded-md text-sm text-gray-300 hover:bg-[#3A3A3A] transition-colors"
              >
                {state.cancelLabel}
              </button>
              <button
                onClick={() => resolve(true)}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-90"
                style={state.danger ? { background: '#EF4444', color: '#fff' } : { background: '#FFB800', color: '#151925' }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

// Returns an async confirm(message | {title, message, confirmLabel, cancelLabel, danger}) => Promise<boolean>
export function useConfirm() {
  return useContext(ConfirmContext)
}
