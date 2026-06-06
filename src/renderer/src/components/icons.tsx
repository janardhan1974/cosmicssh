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
// glance in the sidebar tree.

// Penguin — used for SSH profiles (Linux server mascot).
export function PenguinIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Head */}
      <circle cx="12" cy="8" r="5.5" fill="#1a2035" />
      {/* Body */}
      <ellipse cx="12" cy="17.5" rx="6.5" ry="5.5" fill="#1a2035" />
      {/* White belly */}
      <ellipse cx="12" cy="18" rx="4" ry="4.5" fill="#e8e8dc" />
      {/* Left eye white */}
      <circle cx="10" cy="7" r="1.8" fill="#e8e8dc" />
      {/* Left pupil */}
      <circle cx="10.3" cy="7.2" r="1" fill="#1a2035" />
      {/* Right eye white */}
      <circle cx="14" cy="7" r="1.8" fill="#e8e8dc" />
      {/* Right pupil */}
      <circle cx="14.3" cy="7.2" r="1" fill="#1a2035" />
      {/* Beak — orange triangle pointing down */}
      <polygon points="10.5,10 13.5,10 12,12.5" fill="#f97316" />
      {/* Left foot */}
      <ellipse cx="9.5" cy="22.5" rx="2.2" ry="0.8" fill="#f97316" />
      {/* Right foot */}
      <ellipse cx="14.5" cy="22.5" rx="2.2" ry="0.8" fill="#f97316" />
    </svg>
  )
}

// Parrot — used for SFTP-only / FTP profiles. Colourful tropical bird.
export function ParrotIcon({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Body — green */}
      <ellipse cx="13" cy="16.5" rx="6" ry="5.5" fill="#16a34a" />
      {/* Head — bright green */}
      <circle cx="12" cy="8.5" r="5" fill="#22c55e" />
      {/* Red crown patch */}
      <path d="M9 5.5 Q12 2.5 15 5.5 Q13 7.5 12 7 Q11 7.5 9 5.5Z" fill="#dc2626" />
      {/* Eye — yellow ring + dark pupil */}
      <circle cx="14.5" cy="8.5" r="2" fill="#fef9c3" />
      <circle cx="14.7" cy="8.6" r="1.1" fill="#1e293b" />
      {/* Beak — yellow, hooked downward */}
      <path
        d="M10.5 10 Q9 11.5 9.5 13 Q11 14 12.5 12.5 Q11 12.5 10.5 10Z"
        fill="#eab308"
      />
      {/* Wing — blue accent on left */}
      <path
        d="M8 13.5 Q5.5 17 7 21 Q9.5 22.5 11.5 20.5 Q10 17.5 9.5 14.5Z"
        fill="#3b82f6"
      />
      {/* Tail feathers */}
      <line x1="10" y1="21.5" x2="8.5" y2="24" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="22" x2="12" y2="24.5" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="21.5" x2="15.5" y2="24" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />
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
