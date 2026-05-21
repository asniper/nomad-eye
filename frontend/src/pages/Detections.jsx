import { useEffect, useState, useCallback } from 'react'
import Card from '../components/Card'
import Badge from '../components/Badge'
import { detections } from '../api/client'

const CATEGORY_COLOR = { people: 'blue', vehicles: 'yellow', animals: 'green', other: 'gray' }
const CATEGORIES = ['all', 'people', 'vehicles', 'animals', 'other']
const PAGE_SIZE = 25

function DetectionImage({ id }) {
  const [open, setOpen] = useState(false)
  const src = detections.image(id)
  return (
    <>
      <img
        src={src}
        alt="detection"
        className="w-16 h-12 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity bg-gray-800 shrink-0"
        onClick={() => setOpen(true)}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <img src={src} alt="detection full" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </>
  )
}

export default function Detections() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [camFilter, setCamFilter] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback((p) => {
    setLoading(true)
    const params = { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE }
    if (category !== 'all') params.category = category
    if (camFilter) params.camera_id = parseInt(camFilter)
    if (labelFilter) params.label = labelFilter
    detections.list(params)
      .then(r => {
        setItems(r.data)
        setHasMore(r.data.length === PAGE_SIZE)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [category, camFilter, labelFilter])

  useEffect(() => { setPage(1); load(1) }, [category, camFilter, labelFilter])
  useEffect(() => { load(page) }, [page])

  const changeFilter = (setter) => (val) => { setter(val); setPage(1) }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Detection History</h2>

      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Category</label>
            <div className="flex gap-1 flex-wrap">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => changeFilter(setCategory)(c)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                    category === c ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Camera ID</label>
            <input
              type="number"
              value={camFilter}
              onChange={e => changeFilter(setCamFilter)(e.target.value)}
              placeholder="Any"
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white w-20 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Label</label>
            <input
              type="text"
              value={labelFilter}
              onChange={e => changeFilter(setLabelFilter)(e.target.value)}
              placeholder="Filter by label..."
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </Card>

      <Card>
        {loading && <p className="text-gray-500 text-sm py-4 text-center">Loading...</p>}
        {!loading && items.length === 0 && (
          <p className="text-gray-500 text-sm py-4 text-center">No detections found.</p>
        )}
        <div className="divide-y divide-gray-800">
          {items.map(d => (
            <div key={d.id} className="flex items-center gap-4 py-3">
              <DetectionImage id={d.id} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge label={d.category} color={CATEGORY_COLOR[d.category] || 'gray'} />
                  <span className="text-sm font-medium text-white capitalize">{d.label}</span>
                  <span className="text-xs text-gray-500">Cam {d.camera_id}</span>
                  {d.confidence != null && (
                    <span className="text-xs text-gray-600">{Math.round(d.confidence * 100)}%</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(d.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>

        {!loading && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="px-3 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
