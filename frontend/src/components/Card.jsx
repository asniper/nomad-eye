export default function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-gray-900 rounded-xl p-5 border border-gray-800 ${className}`}>
      {title && <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h3>}
      {children}
    </div>
  )
}
