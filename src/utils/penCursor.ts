/** Build the hardware-rendered draw cursor in screen pixels. */
export function createPenCursor(color: string, strokeWidth: number, zoom: number): string {
  const diameter = Math.max(0, strokeWidth * zoom);
  // The halo needs two pixels of padding. At 124px the complete SVG is 128px,
  // the largest cursor image consistently accepted by Chromium.
  const showRing = diameter >= 6 && diameter <= 124;
  const size = showRing
    ? Math.ceil((diameter + 4) / 2) * 2
    : 8;
  const center = size / 2;
  const ring = showRing
    ? `<circle cx="${center}" cy="${center}" r="${diameter / 2}" fill="none" stroke="white" stroke-width="3"/><circle cx="${center}" cy="${center}" r="${diameter / 2}" fill="none" stroke="${color}" stroke-width="1"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ring}<circle cx="${center}" cy="${center}" r="2" fill="white"/><circle cx="${center}" cy="${center}" r="1" fill="${color}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${center} ${center}, crosshair`;
}
