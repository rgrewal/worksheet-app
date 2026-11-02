import sharp from 'sharp'

/**
 * Binary-mask morphology built on sharp, used correctly.
 *
 * Two sharp behaviours trip people up here (and are why the cutting outline
 * once gained a hand-written replacement):
 *
 *  1. sharp's `dilate()` / `erode()` treat DARK pixels as the foreground —
 *     libvips' "ink on paper" convention. The implementation is an all-zero
 *     structuring matrix followed by `invert()` (see sharp/src/operations.cc).
 *     On a white-subject-on-black mask, such as an alpha channel, `dilate()`
 *     therefore SHRINKS the subject and `erode()` GROWS it.
 *
 *  2. A single `sharp()` instance runs its operations in a fixed internal
 *     order (threshold → dilate → erode → blur → … → negate), not in the
 *     order they were called, and `negate()` is a flag rather than a toggle.
 *     Chaining `.dilate(r).erode(r)` is not a closing, and `.negate()` cannot
 *     be applied "before" a morphological step within one instance. Each step
 *     below is materialised with `toBuffer()` so the sequence is real.
 *
 * All functions take and return a 1-channel mask where 255 = subject, 0 =
 * background. The structuring element is sharp's (2·radius+1)² square, so the
 * offset of a curve grows `radius` on the axes and `radius·√2` on the
 * diagonals. For an exact Euclidean (disk) offset, use the distance-transform
 * pipeline in outline.ts instead.
 *
 * `morphology.test.ts` pins sharp's convention: if a future sharp release
 * changes it, those tests fail rather than the cut line silently flipping.
 */

export interface Mask {
  data: Buffer
  width: number
  height: number
}

/** Grows the white subject by `radius` px in every direction. */
export async function growMask(mask: Mask, radius: number): Promise<Mask> {
  if (radius <= 0) return { ...mask, data: Buffer.from(mask.data) }
  // Ink convention: eroding the dark background grows the white subject.
  return run(mask, s => s.erode(radius))
}

/** Shrinks the white subject by `radius` px in every direction. */
export async function shrinkMask(mask: Mask, radius: number): Promise<Mask> {
  if (radius <= 0) return { ...mask, data: Buffer.from(mask.data) }
  // Ink convention: dilating the dark background shrinks the white subject.
  return run(mask, s => s.dilate(radius))
}

/** Closing: grow then shrink. Bridges gaps narrower than ~2·radius without moving edges. */
export async function closeMask(mask: Mask, radius: number): Promise<Mask> {
  return shrinkMask(await growMask(mask, radius), radius)
}

/** Opening: shrink then grow. Removes specks and strands thinner than ~2·radius. */
export async function openMask(mask: Mask, radius: number): Promise<Mask> {
  return growMask(await shrinkMask(mask, radius), radius)
}

/** Binarises any 1-channel buffer: values > threshold become 255, the rest 0. */
export async function thresholdMask(mask: Mask, threshold = 16): Promise<Mask> {
  return run(mask, s => s.threshold(threshold + 1))
}

// ─── Internals ────────────────────────────────────────────────────────────────

/** One materialised sharp step, forced back to a single channel. */
async function run(mask: Mask, op: (s: sharp.Sharp) => sharp.Sharp): Promise<Mask> {
  const { data, info } = await op(
    sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } }),
  )
    // threshold()/morphology can expand 1 channel to 3; collapse it again
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.channels !== 1) {
    throw new Error(`morphology: expected a 1-channel mask, got ${info.channels}`)
  }
  return { data, width: info.width, height: info.height }
}
