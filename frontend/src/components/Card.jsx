export default function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-[#2E2E2E] rounded-xl p-5 border border-[#3A3A3A] ${className}`}>
      {title && <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#FFB800' }}>{title}</h3>}
      {children}
    </div>
  )
}
