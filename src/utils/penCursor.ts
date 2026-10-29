/**
 * Build the hardware-rendered draw cursor in screen pixels (REQ-DRAW-028).
 *
 * A crosshair like Excalidraw's draw tools, so it is plain that the pen is on
 * and where the ink lands, plus an ink-coloured ring at the pen's width when
 * that is big enough to read. Dark arms on a white halo read on any canvas.
 */
export function createPenCursor(color: string, strokeWidth: number, zoom: number): string {
  const diameter = Math.max(0, strokeWidth * zoom);
  // The halo needs two pixels of padding. At 124px the complete SVG is 128px,
  // the largest cursor image consistently accepted by Chromium.
  const showRing = diameter >= 6 && diameter <= 124;
  const size = Math.max(26, showRing ? Math.ceil((diameter + 4) / 2) * 2 : 0);
  const c = size / 2;
  const ring = showRing
    ? `<circle cx="${c}" cy="${c}" r="${diameter / 2}" fill="none" stroke="white" stroke-width="3"/><circle cx="${c}" cy="${c}" r="${diameter / 2}" fill="none" stroke="${color}" stroke-width="1"/>`
    : '';
  // Arms 8px long with a 3px gap round the hotspot, clear of the image edge.
  const arms = `M${c} ${c - 11}V${c - 3}M${c} ${c + 3}V${c + 11}M${c - 11} ${c}H${c - 3}M${c + 3} ${c}H${c + 11}`;
  const cross = `<path d="${arms}" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="${arms}" stroke="#14181A" stroke-width="1"/>`;
  const dot = `<circle cx="${c}" cy="${c}" r="1.5" fill="${color}" stroke="white" stroke-width="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ring}${cross}${dot}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}
