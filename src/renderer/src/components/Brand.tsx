export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
    >
      <path d="M512 512L838.3 359.9A360 360 0 1 1 574.5 157.5Z" fill="currentColor" />
      <path
        d="M838.3 359.9A360 360 0 1 1 574.5 157.5"
        stroke="var(--brand,#d9482b)"
        strokeWidth="52"
        strokeLinecap="round"
      />
      <circle cx="452" cy="372" r="48" fill="var(--brand,#d9482b)" />
      <circle cx="650" cy="540" r="40" fill="var(--brand,#d9482b)" />
      <circle cx="472" cy="690" r="34" fill="var(--brand,#d9482b)" />
      <circle cx="700" cy="700" r="26" fill="var(--brand,#d9482b)" />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <BrandMark size={18} />
      </span>
      <span className="brand-name">Pizza</span>
    </span>
  )
}
