import { useState, useRef, useCallback } from 'react'
import { detections as detectionsApi, settings as settingsApi } from '../api/client'

// Manual diagnostic tool for a locked recording: capture one frame, draw a box
// around whatever the live detector missed, and see what the model actually
// scored there — on the full frame and on a cropped+upscaled version (the same
// trick already used for face-detection retries). Runs on the device's
// existing model, serialized behind the same lock live camera detection uses,
// so it never runs concurrently with it — see reanalyze_frame in pipeline.py.
export default function ReanalyzeModal({ segmentId, videoUrl, onClose }) {
  const [stage, setStage] = useState('capture') // capture | draw | running | result
  const [frameDataUrl, setFrameDataUrl] = useState(null)
  const [label, setLabel] = useState('')
  const [box, setBox] = useState(null) // {x1,y1,x2,y2} in native frame pixels
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const drawingRef = useRef(null) // {x1,y1} start point, in native pixels, while dragging

  const captureFrame = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    setFrameDataUrl(c.toDataURL('image/jpeg', 0.9))
    setBox(null)
    setStage('draw')
  }, [])

  const nativePoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const point = e.touches?.[0] || e.changedTouches?.[0] || e
    return {
      x: Math.round((point.clientX - rect.left) * scaleX),
      y: Math.round((point.clientY - rect.top) * scaleY),
    }
  }

  const redraw = useCallback((liveBox) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const b = liveBox || box
    if (b) {
      ctx.strokeStyle = '#FFB800'
      ctx.lineWidth = Math.max(2, canvas.width / 300)
      ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1)
    }
  }, [box])

  const onImgLoad = () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    redraw(null)
  }

  const startDrawing = (e) => {
    drawingRef.current = nativePoint(e)
  }
  const continueDrawing = (e) => {
    if (!drawingRef.current) return
    const p = nativePoint(e)
    const start = drawingRef.current
    const live = {
      x1: Math.min(start.x, p.x), y1: Math.min(start.y, p.y),
      x2: Math.max(start.x, p.x), y2: Math.max(start.y, p.y),
    }
    redraw(live)
  }
  const finishDrawing = (e) => {
    if (!drawingRef.current) return
    const p = nativePoint(e)
    const start = drawingRef.current
    drawingRef.current = null
    const finalBox = {
      x1: Math.min(start.x, p.x), y1: Math.min(start.y, p.y),
      x2: Math.max(start.x, p.x), y2: Math.max(start.y, p.y),
    }
    if (finalBox.x2 - finalBox.x1 < 5 || finalBox.y2 - finalBox.y1 < 5) return // ignore accidental clicks/taps
    setBox(finalBox)
    redraw(finalBox)
  }

  // Touch variants prevent default so dragging a box doesn't also scroll/zoom
  // the page underneath — mobile Safari/Chrome treat an un-prevented touchmove
  // on a canvas as a scroll gesture by default.
  const handleTouchStart = (e) => { e.preventDefault(); startDrawing(e) }
  const handleTouchMove = (e) => { e.preventDefault(); continueDrawing(e) }
  const handleTouchEnd = (e) => { e.preventDefault(); finishDrawing(e) }

  const runReanalysis = async () => {
    if (!box || !label.trim()) return
    setStage('running')
    setError('')
    try {
      const r = await detectionsApi.reanalyzeContinuous(
        segmentId, frameDataUrl, [box.x1, box.y1, box.x2, box.y2], label.trim()
      )
      setResult(r.data)
      setStage('result')
    } catch (e) {
      setError(e?.response?.data?.detail || 'Reanalysis failed')
      setStage('draw')
    }
  }

  const applyThreshold = async () => {
    if (!result?.config_key || result.suggested_threshold == null) return
    setApplying(true)
    try {
      await settingsApi.set(result.config_key, String(result.suggested_threshold))
      setApplied(true)
    } catch {}
    setApplying(false)
  }

  const retryCapture = () => {
    setStage('capture')
    setResult(null)
    setError('')
    setApplied(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#2E2E2E] rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-[#3A3A3A]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Diagnose a Missed Detection</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {stage === 'capture' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Play or scrub to the moment you want to check, pause it, then capture that frame.
            </p>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="w-full rounded-lg bg-black"
            />
            <button
              onClick={captureFrame}
              className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: '#FFB800', color: '#151925' }}
            >
              Capture This Frame
            </button>
          </div>
        )}

        {stage === 'draw' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Draw a box around what the detector missed, then say what it actually is.
            </p>
            <div className="relative">
              <img ref={imgRef} src={frameDataUrl} alt="captured frame" className="hidden" onLoad={onImgLoad} />
              <canvas
                ref={canvasRef}
                className="w-full rounded-lg cursor-crosshair block"
                style={{ touchAction: 'none' }}
                onMouseDown={startDrawing}
                onMouseMove={continueDrawing}
                onMouseUp={finishDrawing}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              />
            </div>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="What's in the box? e.g. bear"
              className="w-full bg-[#3A3A3A] border border-[#484848] rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={retryCapture}
                className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >Recapture</button>
              <button
                onClick={runReanalysis}
                disabled={!box || !label.trim()}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{ background: '#FFB800', color: '#151925' }}
              >
                Run Reanalysis
              </button>
            </div>
          </div>
        )}

        {stage === 'running' && (
          <div className="py-12 flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-500 text-center">
              Running diagnostic — waits for any live detection in progress to finish first, so this can take a moment.
            </p>
          </div>
        )}

        {stage === 'result' && result && (
          <div className="space-y-4">
            <ResultRow title="Full frame" det={result.full_frame} />
            <ResultRow title="Cropped + upscaled" det={result.cropped_upscaled} />

            {result.suggested_threshold != null ? (
              <div className="p-3 rounded-lg" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <p className="text-sm text-white">
                  Current <span className="font-mono">{result.config_key}</span> is{' '}
                  <span className="font-mono">{result.current_threshold}</span>.
                  Lowering it to <span className="font-mono text-[#FFB800]">{result.suggested_threshold}</span> would have caught this.
                </p>
                <button
                  onClick={applyThreshold}
                  disabled={applying || applied}
                  className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ background: '#FFB800', color: '#151925' }}
                >
                  {applied ? '✓ Applied' : applying ? 'Applying…' : `Apply — set to ${result.suggested_threshold}`}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Not detected even with crop + upscale at a near-zero threshold — this likely isn't a threshold problem.
                Consider a different model, more light/IR range, or a closer camera angle for this spot.
              </p>
            )}
            {result.timed_out && (
              <p className="text-xs text-yellow-500">Live detection stayed busy longer than expected — results above may be incomplete.</p>
            )}

            <button
              onClick={retryCapture}
              className="w-full px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors border border-[#3A3A3A]"
            >Try Another Frame</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultRow({ title, det }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">{title}</span>
      {det ? (
        <span className="text-white">
          <span className="capitalize">{det.label}</span>{' '}
          <span className="font-mono text-[#FFB800]">{Math.round(det.confidence * 100)}%</span>
        </span>
      ) : (
        <span className="text-gray-600">nothing found</span>
      )}
    </div>
  )
}
