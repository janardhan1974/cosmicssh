// Hand-crafted inline SVG icons. Inline so they scale crisply and we can
// theme individual paths without a separate icon library.

type Props = { size?: number; className?: string }

// SSH / Terminal — dark "console" with macOS-style traffic lights and a
// glowing cyan prompt. Reads as "shell" at any size.
export function TerminalIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Outer screen */}
      <rect x="2" y="3" width="20" height="18" rx="2.5" fill="#0d1424" stroke="#3a4566" strokeWidth="1" />
      {/* Title bar */}
      <rect x="2" y="3" width="20" height="4" rx="2.5" fill="#1c2540" />
      <line x1="2" y1="7" x2="22" y2="7" stroke="#3a4566" strokeWidth="0.6" />
      {/* Traffic lights */}
      <circle cx="5" cy="5" r="0.85" fill="#ff5f57" />
      <circle cx="7.5" cy="5" r="0.85" fill="#febc2e" />
      <circle cx="10" cy="5" r="0.85" fill="#28c940" />
      {/* Prompt > */}
      <path
        d="M5 13.5 L7.5 15.5 L5 17.5"
        stroke="#7ce38b"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor block */}
      <rect x="9" y="14.5" width="3.5" height="2.5" fill="#5af0d8" rx="0.3" />
    </svg>
  )
}

// SFTP — folder with two arrows (orange = upload, green = download).
// Reads as "files going both ways."
export function SftpIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Folder back */}
      <path
        d="M2 6 L9 6 L11 8 L22 8 L22 19 C22 19.6 21.6 20 21 20 L3 20 C2.4 20 2 19.6 2 19 Z"
        fill="#3b66c4"
        stroke="#284a96"
        strokeWidth="0.7"
      />
      {/* Folder front (lighter) */}
      <path
        d="M2.5 9 L21.5 9 L21.5 19 C21.5 19.3 21.3 19.5 21 19.5 L3 19.5 C2.7 19.5 2.5 19.3 2.5 19 Z"
        fill="#5d8be8"
      />
      {/* Up arrow (orange) on the left side */}
      <path
        d="M8 17 L8 13 M6 15 L8 13 L10 15"
        stroke="#ff924a"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Down arrow (green) on the right side */}
      <path
        d="M16 12 L16 16 M14 14 L16 16 L18 14"
        stroke="#5af0a2"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Sidebar profile-row icons ──────────────────────────────────────────
// Bright + distinctive at 14–18px so SSH and SFTP-only profiles read at a
// glance in the sidebar tree. Different shapes (rectangle + stand vs disc)
// so they're discernible even on a tiny resolution.

// Computer / monitor — used for SSH profiles.
export function ComputerIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Monitor outer frame */}
      <rect x="1.5" y="3" width="21" height="14" rx="2" fill="#2d3142" stroke="#5a6688" strokeWidth="0.8" />
      {/* Screen */}
      <rect x="2.8" y="4.2" width="18.4" height="11.6" rx="0.8" fill="#0a1424" />
      {/* Screen "code" lines — alternating green / cyan to evoke a terminal */}
      <rect x="4.5" y="6" width="10" height="0.9" rx="0.3" fill="#7ce38b" />
      <rect x="4.5" y="8" width="6" height="0.8" rx="0.2" fill="#5af0d8" />
      <rect x="4.5" y="9.5" width="13" height="0.8" rx="0.2" fill="#7ce38b" />
      <rect x="4.5" y="11" width="8" height="0.8" rx="0.2" fill="#5af0d8" />
      <rect x="4.5" y="12.5" width="11" height="0.8" rx="0.2" fill="#7ce38b" />
      {/* Caret cursor */}
      <rect x="13.8" y="12.5" width="1.6" height="0.9" fill="#febc2e" />
      {/* Stand */}
      <rect x="10" y="17.2" width="4" height="2.3" fill="#5a6688" />
      {/* Base */}
      <rect x="6.5" y="19.5" width="11" height="1.6" rx="0.4" fill="#5a6688" />
    </svg>
  )
}

// Globe — used for SFTP-only profiles. Says "remote / over-the-wire" and
// looks visually distinct from the Computer at small sizes.
export function GlobeIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Ocean */}
      <circle cx="12" cy="12" r="9.5" fill="#1d6db8" stroke="#0e4a7f" strokeWidth="0.8" />
      {/* Subtle top-left highlight */}
      <ellipse cx="9" cy="8.5" rx="5" ry="3" fill="#3a8fd0" opacity="0.55" />
      {/* Continents — three irregular green blobs */}
      <path
        d="M4.5 10 Q6.5 7.5 9 9 Q11.5 10.5 8.5 12 Q6.5 12.5 5 11 Q4 10.7 4.5 10 Z"
        fill="#5fbf4f"
        stroke="#3a8c30"
        strokeWidth="0.35"
      />
      <path
        d="M11 14 Q13.5 13 16 14.5 Q18 16 15.5 17 Q13 17.5 11.5 16.5 Q10.5 15.5 11 14 Z"
        fill="#5fbf4f"
        stroke="#3a8c30"
        strokeWidth="0.35"
      />
      <path
        d="M16.5 6 Q18.5 5.5 19.5 7 Q19.5 8.5 17.5 8.2 Q15.8 7.8 16.5 6 Z"
        fill="#5fbf4f"
        stroke="#3a8c30"
        strokeWidth="0.35"
      />
      {/* Latitude lines */}
      <ellipse cx="12" cy="12" rx="9.5" ry="3" fill="none" stroke="#ffffff" strokeWidth="0.5" opacity="0.45" />
      <ellipse cx="12" cy="12" rx="9.5" ry="6" fill="none" stroke="#ffffff" strokeWidth="0.4" opacity="0.32" />
      {/* Longitude */}
      <ellipse cx="12" cy="12" rx="3.2" ry="9.5" fill="none" stroke="#ffffff" strokeWidth="0.5" opacity="0.5" />
      {/* Crisp outer outline */}
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="#0a3a6a" strokeWidth="0.6" />
    </svg>
  )
}

// "Server" / "host" icon — was the original sidebar icon. Kept exported in
// case we want it elsewhere; sidebar now uses ComputerIcon / GlobeIcon.
export function ServerIcon({ size = 14, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Top server */}
      <rect x="3" y="4" width="18" height="6" rx="1.4" fill="#3b4566" stroke="#5a6688" strokeWidth="0.5" />
      <circle cx="6" cy="7" r="0.9" fill="#5af0a2" />
      <rect x="9" y="6.4" width="9" height="1.2" fill="#7a85aa" rx="0.3" />
      {/* Bottom server */}
      <rect x="3" y="14" width="18" height="6" rx="1.4" fill="#3b4566" stroke="#5a6688" strokeWidth="0.5" />
      <circle cx="6" cy="17" r="0.9" fill="#febc2e" />
      <rect x="9" y="16.4" width="9" height="1.2" fill="#7a85aa" rx="0.3" />
    </svg>
  )
}
