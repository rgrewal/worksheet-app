/**
 * Subject shapes shared by the cutting-outline geometry tests
 * (services/outline.shapes.test.ts) and the visual gallery
 * (scripts/outlineGallery.ts), so what is asserted is what is pictured.
 */

export type Point = { x: number; y: number }

export interface Shape {
  name: string
  /** SVG elements, drawn in black; the canvas is transparent */
  svg: string
  /** True when the outer boundary is convex, so the cut line is an exact offset everywhere */
  convex: boolean
  /** A transparent point that must end up inside the cut region (hole / enclosed gap) */
  enclosedPoint?: Point
}

export const SHAPE_CANVAS = 512
export const SHAPE_CENTRE = SHAPE_CANVAS / 2
const C = SHAPE_CENTRE

export const SHAPES: Shape[] = [
  {
    name: 'circle',
    svg: `<circle cx="${C}" cy="${C}" r="180"/>`,
    convex: true,
  },
  {
    name: 'square',
    svg: `<rect x="${C - 150}" y="${C - 150}" width="300" height="300"/>`,
    convex: true,
  },
  {
    name: 'rotated square (diagonal edges)',
    svg: `<rect x="${C - 130}" y="${C - 130}" width="260" height="260" transform="rotate(30 ${C} ${C})"/>`,
    convex: true,
  },
  {
    name: 'wide ellipse',
    svg: `<ellipse cx="${C}" cy="${C}" rx="220" ry="110"/>`,
    convex: true,
  },
  {
    name: 'off-centre blob near the canvas edge',
    svg: `<ellipse cx="150" cy="140" rx="130" ry="100"/>`,
    convex: true,
  },
  {
    name: 'doughnut (transparent hole)',
    svg: `<path fill-rule="evenodd" d="M ${C} ${C - 190} a 190 190 0 1 0 0.01 0 Z M ${C} ${C - 80} a 80 80 0 1 1 -0.01 0 Z"/>`,
    convex: true,               // the outer boundary is convex; the hole must be ignored
    enclosedPoint: { x: C, y: C },
  },
  {
    name: 'five-point star (concave)',
    svg: `<polygon points="${starPoints(C, C, 200, 85, 5)}"/>`,
    convex: false,
  },
  {
    name: 'crescent (deep concavity)',
    svg: `<path fill-rule="evenodd" d="M ${C} ${C - 190} a 190 190 0 1 0 0.01 0 Z M ${C + 70} ${C - 150} a 150 150 0 1 1 -0.01 0 Z"/>`,
    convex: false,
  },
  {
    name: 'dumbbell (two discs joined by a 24 px bar)',
    svg: `<circle cx="${C - 150}" cy="${C}" r="80"/><circle cx="${C + 150}" cy="${C}" r="80"/><rect x="${C - 150}" y="${C - 12}" width="300" height="24"/>`,
    convex: false,
    enclosedPoint: { x: C, y: C },
  },
  {
    name: 'L-shape',
    svg: `<path d="M 120 100 H 240 V 300 H 400 V 420 H 120 Z"/>`,
    convex: false,
  },
]

function starPoints(cx: number, cy: number, outer: number, inner: number, n: number): string {
  const pts: string[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / n
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}


/** Full SVG document for a shape: black silhouette on a transparent canvas */
export function shapeSvg(shape: Shape): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHAPE_CANVAS}" height="${SHAPE_CANVAS}">${shape.svg}</svg>`
}
