export function MetronomeIcon({ size = 27 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3h8l6 22H4z" />
      <path d="m10 21 11-18M13 13h4M12 17h3" />
    </svg>
  );
}
