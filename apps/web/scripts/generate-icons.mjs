/**
 * Draws the app icons the PWA manifest declares.
 *
 * Written as a script rather than committed by hand so the icons can be
 * regenerated when the brand changes, and so there is no mystery about where a
 * binary in the repository came from. Uses only node:zlib, because pulling an
 * image library in to draw four shapes would be the larger cost.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Must match --color-bg and --color-up in src/index.css.
const BACKGROUND = [0x0b, 0x0f, 0x14];
const RISE = [0x3d, 0xdc, 0x97];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixels(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance from a point to a line segment, for drawing a stroke. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * A rising quote line, which is the one thing this product is about. Drawn on
 * the full square: maskable icons are cropped to a circle by some launchers, so
 * the line stays well inside the safe area.
 */
function draw(size) {
  const unit = size / 100;
  const stroke = 7 * unit;

  // Points of the line, in a 0..100 space, with y measured downwards.
  const path = [
    [18, 70],
    [38, 52],
    [54, 62],
    [82, 26],
  ];

  const arrow = [
    [82, 26],
    [64, 26],
  ];
  const arrowDown = [
    [82, 26],
    [82, 44],
  ];

  return (x, y) => {
    const px = x / unit;
    const py = y / unit;

    let nearest = Infinity;
    for (let index = 0; index < path.length - 1; index += 1) {
      const [ax, ay] = path[index];
      const [bx, by] = path[index + 1];
      nearest = Math.min(nearest, distanceToSegment(px, py, ax, ay, bx, by));
    }
    for (const [[ax, ay], [bx, by]] of [
      [arrow[0], arrow[1]],
      [arrowDown[0], arrowDown[1]],
    ]) {
      nearest = Math.min(nearest, distanceToSegment(px, py, ax, ay, bx, by));
    }

    return nearest * unit <= stroke / 2 ? RISE : BACKGROUND;
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, draw(size)));
  console.log(`wrote ${file}`);
}

// iOS ignores the manifest and looks for this one.
writeFileSync(join(OUT_DIR, 'apple-touch-icon.png'), encodePng(180, draw(180)));
console.log(`wrote ${join(OUT_DIR, 'apple-touch-icon.png')}`);
