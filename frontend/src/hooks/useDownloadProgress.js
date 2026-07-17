import { useRef, useState, useCallback } from 'react'

// Tracks byte-level download progress for a single in-flight blob fetch (axios
// onDownloadProgress) and derives percent/ETA from elapsed wall-clock time.
// Videos here are bandwidth-bound (slow uplink at the camera's location), not
// server-bound, so a real progress bar is worth the byte-counting — plain
// <video src> gives no usable progress signal until the whole blob lands anyway.
export function useDownloadProgress() {
  const startRef = useRef(null)
  const [progress, setProgress] = useState(null)

  const reset = useCallback(() => {
    startRef.current = null
    setProgress(null)
  }, [])

  const onDownloadProgress = useCallback((e) => {
    if (startRef.current === null) startRef.current = Date.now()
    if (!e.total) {
      setProgress({ percent: null, loaded: e.loaded, total: null, etaSeconds: null })
      return
    }
    const elapsed = (Date.now() - startRef.current) / 1000
    const bytesPerSec = elapsed > 0 ? e.loaded / elapsed : 0
    const etaSeconds = bytesPerSec > 0 ? (e.total - e.loaded) / bytesPerSec : null
    setProgress({
      percent: Math.round((e.loaded / e.total) * 100),
      loaded: e.loaded,
      total: e.total,
      etaSeconds,
    })
  }, [])

  return { progress, onDownloadProgress, reset }
}
