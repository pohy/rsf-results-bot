// windows-1250 (Central European) single-byte decoder.
//
// Bun rejects `new TextDecoder('windows-1250')` with ERR_ENCODING_NOT_SUPPORTED
// (Bun 1.3.x), unlike Node and browsers. The RSF site serves CP-1250 HTML with
// no charset declaration, so we decode it ourselves.
//
// Bytes 0x00–0x7F are ASCII. Only the high half (0x80–0xFF) differs; the table
// below was generated from the `windows-1250` npm package and validated
// (0x8A→Š U+0160, 0xE4→ä U+00E4). The five positions undefined in CP-1250
// (0x81 0x83 0x88 0x90 0x98) map to their own byte value — they never appear in
// the Hungarian/Czech text this scraper handles.
const HIGH_CODEPOINTS = [
  8364, 129, 8218, 131, 8222, 8230, 8224, 8225, 136, 8240, 352, 8249, 346, 356,
  381, 377, 144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 152, 8482, 353, 8250,
  347, 357, 382, 378, 160, 711, 728, 321, 164, 260, 166, 167, 168, 169, 350,
  171, 172, 173, 174, 379, 176, 177, 731, 322, 180, 181, 182, 183, 184, 261,
  351, 187, 317, 733, 318, 380, 340, 193, 194, 258, 196, 313, 262, 199, 268,
  201, 280, 203, 282, 205, 206, 270, 272, 323, 327, 211, 212, 336, 214, 215,
  344, 366, 218, 368, 220, 221, 354, 223, 341, 225, 226, 259, 228, 314, 263,
  231, 269, 233, 281, 235, 283, 237, 238, 271, 273, 324, 328, 243, 244, 337,
  246, 247, 345, 367, 250, 369, 252, 253, 355, 729,
];

const HIGH = String.fromCharCode(...HIGH_CODEPOINTS);

export function decodeCp1250(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : HIGH[b - 0x80];
  }
  return out;
}
