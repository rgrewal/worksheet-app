// ─── Corner illustration library ──────────────────────────────────────────────
// 10 simple SVG line drawings. All use a 64×64 viewBox, black strokes on white
// fills — matching the maze's clean line-drawing aesthetic.
// Selected for diversity across common kid interests.

const SVGS: readonly string[] = [
  // 0 — Rocket
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <path d="M32 4 C22 4 16 16 16 30 L16 52 L48 52 L48 30 C48 16 42 4 32 4 Z"
      fill="white" stroke="black" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="32" cy="24" r="7" fill="white" stroke="black" stroke-width="2.5"/>
    <path d="M16 44 L6 56 L16 50 Z" fill="white" stroke="black" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M48 44 L58 56 L48 50 Z" fill="white" stroke="black" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 52 Q28 62 32 58 Q36 62 40 52" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  // 1 — Crown
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <path d="M8 48 L8 22 L20 34 L32 10 L44 34 L56 22 L56 48 Z"
      fill="white" stroke="black" stroke-width="3" stroke-linejoin="round"/>
    <rect x="8" y="44" width="48" height="10" rx="2" fill="white" stroke="black" stroke-width="3"/>
  </svg>`,

  // 2 — Paw print
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <ellipse cx="32" cy="46" rx="14" ry="12" fill="white" stroke="black" stroke-width="3"/>
    <ellipse cx="14" cy="30" rx="6" ry="7" fill="white" stroke="black" stroke-width="2.5"/>
    <ellipse cx="26" cy="24" rx="6" ry="7" fill="white" stroke="black" stroke-width="2.5"/>
    <ellipse cx="38" cy="24" rx="6" ry="7" fill="white" stroke="black" stroke-width="2.5"/>
    <ellipse cx="50" cy="30" rx="6" ry="7" fill="white" stroke="black" stroke-width="2.5"/>
  </svg>`,

  // 3 — Football
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <ellipse cx="32" cy="32" rx="24" ry="15" fill="white" stroke="black" stroke-width="3"/>
    <line x1="32" y1="20" x2="32" y2="44" stroke="black" stroke-width="2" stroke-linecap="round"/>
    <line x1="26" y1="27" x2="38" y2="27" stroke="black" stroke-width="2" stroke-linecap="round"/>
    <line x1="25" y1="32" x2="39" y2="32" stroke="black" stroke-width="2" stroke-linecap="round"/>
    <line x1="26" y1="37" x2="38" y2="37" stroke="black" stroke-width="2" stroke-linecap="round"/>
  </svg>`,

  // 4 — Star
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <polygon points="32,5 38.5,23 58,24 42.5,35.5 48,54 32,43 16,54 21.5,35.5 6,24 25.5,23"
      fill="white" stroke="black" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,

  // 5 — Rainbow
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <path d="M4 58 A28 28 0 0 1 60 58" fill="none" stroke="black" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M11 58 A21 21 0 0 1 53 58" fill="none" stroke="black" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M18 58 A14 14 0 0 1 46 58" fill="none" stroke="black" stroke-width="4.5" stroke-linecap="round"/>
  </svg>`,

  // 6 — Lightning bolt
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <polygon points="40,4 20,36 32,36 24,60 44,28 32,28"
      fill="white" stroke="black" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,

  // 7 — Heart
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <path d="M32 56 C14 44 6 34 6 24 C6 15 12 9 20 9 C25 9 30 13 32 18 C34 13 39 9 44 9 C52 9 58 15 58 24 C58 34 50 44 32 56 Z"
      fill="white" stroke="black" stroke-width="3" stroke-linejoin="round"/>
  </svg>`,

  // 8 — Dinosaur footprint
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <ellipse cx="32" cy="18" rx="6" ry="12" fill="white" stroke="black" stroke-width="2.5"/>
    <ellipse cx="17" cy="22" rx="5" ry="10" fill="white" stroke="black" stroke-width="2.5" transform="rotate(-20 17 22)"/>
    <ellipse cx="47" cy="22" rx="5" ry="10" fill="white" stroke="black" stroke-width="2.5" transform="rotate(20 47 22)"/>
    <ellipse cx="32" cy="46" rx="14" ry="10" fill="white" stroke="black" stroke-width="2.5"/>
  </svg>`,

  // 9 — Musical note
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <ellipse cx="22" cy="50" rx="12" ry="8" fill="white" stroke="black" stroke-width="3" transform="rotate(-15 22 50)"/>
    <line x1="33" y1="48" x2="33" y2="12" stroke="black" stroke-width="3" stroke-linecap="round"/>
    <path d="M33 12 C48 16 50 26 40 32" fill="none" stroke="black" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
]

// ─── Hash ─────────────────────────────────────────────────────────────────────

function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deterministically picks one of 10 corner illustrations based on the interest
 * string. The same interest always returns the same illustration.
 */
export function getCornerImage(interest: string): string {
  const key = interest.trim().toLowerCase()
  return SVGS[djb2(key) % SVGS.length]
}
