const fmtMb = (n) => (n / (1024 * 1024)).toFixed(1)

export default function VideoLoadProgress({ progress, fill = false }) {
  const percent = progress?.percent ?? 0
  const hasTotal = progress?.total != null

  return (
    <div className={`${fill ? 'w-full h-full absolute inset-0' : 'w-full aspect-video'} bg-[#3A3A3A] rounded-lg flex flex-col items-center justify-center gap-3 p-4`}>
      <div className="w-2/3 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${hasTotal ? percent : 15}%`, background: '#FFB800' }}
        />
      </div>
      <p className="text-xs text-gray-400 text-center">
        {hasTotal ? `${percent}% — ${fmtMb(progress.loaded)} / ${fmtMb(progress.total)} MB` : 'Loading…'}
        {progress?.etaSeconds != null && progress.etaSeconds > 1 && (
          <span className="block text-gray-500 mt-0.5">~{Math.ceil(progress.etaSeconds)}s remaining</span>
        )}
      </p>
    </div>
  )
}
