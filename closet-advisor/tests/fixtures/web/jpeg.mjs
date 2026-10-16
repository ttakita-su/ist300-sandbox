// A tiny baseline JPEG encoder for test fixtures, with no dependencies. Every 8x8 block is one
// flat color, so only the DC coefficient of each block is coded (no DCT is needed) and every AC run
// is an end-of-block. The result is an ordinary baseline JFIF file (standard Huffman tables, 4:4:4
// YCbCr) that browsers decode, draw on a canvas and re-encode like any photo.

// Standard Huffman tables (ITU T.81 Annex K.3): code-length counts for lengths 1-16, then symbols.
const DC_LUMA = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
// prettier-ignore
const AC_LUMA = {
  bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  values: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};
// prettier-ignore
const AC_CHROMA = {
  bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  values: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
    0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
    0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

// One flat quantization table: a block's DC coefficient is 8 x (mean - 128), so a step of 8 keeps
// the block color exact. AC steps never matter because every AC coefficient is zero.
const QUANT_STEP = 8;

function huffmanCodes({ bits, values }) {
  if (bits.reduce((a, b) => a + b, 0) !== values.length) throw new Error('Huffman table counts and symbols disagree');
  const codes = new Map();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) codes.set(values[k++], { code: code++, length });
    code <<= 1;
  }
  return codes;
}

const TABLES = [
  { dc: huffmanCodes(DC_LUMA), ac: huffmanCodes(AC_LUMA) },
  { dc: huffmanCodes(DC_CHROMA), ac: huffmanCodes(AC_CHROMA) },
];

function segment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/**
 * Encodes an image as a baseline JPEG.
 * @param {number} width multiple of 8
 * @param {number} height multiple of 8
 * @param {(x: number, y: number) => [number, number, number]} colorAt RGB 0-255, sampled at each block's center
 * @returns {Buffer}
 */
export function encodeJpeg(width, height, colorAt) {
  if (width % 8 || height % 8 || width < 8 || height < 8 || width > 65535 || height > 65535) throw new Error('Width and height must be multiples of 8');
  const out = [];
  let acc = 0;
  let filled = 0;
  const writeBits = (code, length) => {
    for (let i = length - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++filled === 8) {
        out.push(acc);
        if (acc === 0xff) out.push(0x00); // byte stuffing
        acc = 0;
        filled = 0;
      }
    }
  };
  const previous = [0, 0, 0];
  for (let by = 0; by < height / 8; by++) {
    for (let bx = 0; bx < width / 8; bx++) {
      const [r, g, b] = colorAt(bx * 8 + 4, by * 8 + 4);
      const ycc = [0.299 * r + 0.587 * g + 0.114 * b, -0.168736 * r - 0.331264 * g + 0.5 * b + 128, 0.5 * r - 0.418688 * g - 0.081312 * b + 128];
      for (let c = 0; c < 3; c++) {
        const { dc, ac } = TABLES[c === 0 ? 0 : 1];
        const level = Math.max(-128, Math.min(127, Math.round(ycc[c] - 128)));
        const diff = level - previous[c];
        previous[c] = level;
        let size = 0;
        for (let a = Math.abs(diff); a; a >>= 1) size++;
        const symbol = dc.get(size);
        writeBits(symbol.code, symbol.length);
        if (size) writeBits(diff >= 0 ? diff : diff + (1 << size) - 1, size);
        const eob = ac.get(0x00);
        writeBits(eob.code, eob.length);
      }
    }
  }
  while (filled) writeBits(1, 1); // pad the last byte with 1-bits

  const dht = [];
  for (const [klass, table] of [[0x00, DC_LUMA], [0x10, AC_LUMA], [0x01, DC_CHROMA], [0x11, AC_CHROMA]]) dht.push(klass, ...table.bits, ...table.values);
  // prettier-ignore
  return Buffer.from([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    ...segment(0xdb, [0x00, ...new Array(64).fill(QUANT_STEP)]),
    ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    ...segment(0xc4, dht),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
    ...out,
    0xff, 0xd9,
  ]);
}

/** Width and height from a JPEG's frame header, or null. */
export function jpegSize(bytes) {
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

/**
 * A side view of a plain court sneaker on a light background, as a JPEG.
 * @param {{ size?: number, background?: string, upper?: string, sole?: string, accent?: string }} [colors] hex colors
 */
export function sneakerJpeg({ size = 480, background = '#eeeae4', upper = '#fbfbf8', sole = '#e9e4da', accent = '#d9d6cf' } = {}) {
  const [bg, up, so, ac] = [background, upper, sole, accent].map(hex);
  const shadow = bg.map((v) => Math.round(v * 0.86));
  const collar = up.map((v) => Math.round(v * 0.7));
  // The top edge of the shoe: high at the heel (left), low at the toe (right).
  const top = (u) => 0.36 + 0.2 * Math.min(1, Math.max(0, (u - 0.32) / 0.5));
  return encodeJpeg(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    if (u >= 0.12 && u <= 0.88 && v >= 0.62 && v <= 0.7) return so;
    if (u >= 0.15 && u <= 0.86 && v > 0.7 && v <= 0.73) return shadow;
    const toe = u <= 0.72 || ((u - 0.72) / 0.15) ** 2 + ((v - 0.62) / (0.62 - top(0.72))) ** 2 <= 1;
    if (u >= 0.14 && u <= 0.87 && v >= top(u) && v < 0.62 && toe) {
      if (u <= 0.3 && v <= top(u) + 0.045) return collar;
      if (u >= 0.3 && u <= 0.74 && Math.abs(v - (0.56 - 0.2 * (u - 0.3))) < 0.022) return ac;
      return up;
    }
    return bg;
  });
}
