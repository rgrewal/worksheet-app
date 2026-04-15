// ─── SVG result ───────────────────────────────────────────────────────────────

export interface CuttingSvgResult {
  svg: string
  svgW: number
  svgH: number
  clearing: { svgX: number; svgY: number; svgSize: number }
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateCuttingSvg(): CuttingSvgResult {
  const W = 500
  const H = 500
  // ── Icon box — centred in the SVG ────────────────────────────────────────
  const ICON_BOX = 300
  const iconX = (W - ICON_BOX) / 2
  const iconY = (H - ICON_BOX) / 2
  const clearing = { svgX: iconX, svgY: iconY, svgSize: ICON_BOX }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `  <rect width="${W}" height="${H}" fill="white"/>`,
    `</svg>`,
  ].join('\n')

  return { svg, svgW: W, svgH: H, clearing }
}
