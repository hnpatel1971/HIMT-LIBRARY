// Code 128 barcodes, drawn as SVG. Code set B covers every barcode the library
// uses (HI01299MT, E00008B); a code made only of digits, in pairs, uses the
// shorter code set C.

// Bar and space widths for symbols 0-106, from the Code 128 standard.
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 " +
  "113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
  "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 " +
  "113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 " +
  "241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
  "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 " +
  "211232 2331112"
).split(" ");
const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Symbol values for a code, start and check symbols included, stop excluded. */
export function code128Symbols(text: string): number[] {
  if (!text) throw new Error("Nothing to encode");
  let symbols: number[];
  if (/^(\d\d)+$/.test(text)) {
    symbols = [START_C, ...(text.match(/\d\d/g) ?? []).map(Number)];
  } else {
    symbols = [START_B];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error(`Cannot put "${ch}" in a barcode`);
      symbols.push(c - 32);
    }
  }
  const check = symbols.reduce((sum, v, i) => sum + v * Math.max(i, 1), 0) % 103;
  return [...symbols, check];
}

/** Bar and space widths in modules, starting with a bar. */
export function code128Widths(text: string): number[] {
  return [...code128Symbols(text), STOP].flatMap((s) => [...PATTERNS[s]].map(Number));
}

/** SVG markup for a barcode, with a 10-module quiet zone on each side. */
export function code128Svg(text: string, height = 40): string {
  const quiet = 10;
  let x = quiet;
  const bars: string[] = [];
  code128Widths(text).forEach((w, i) => {
    if (i % 2 === 0) bars.push(`M${x} 0h${w}v${height}h-${w}z`);
    x += w;
  });
  const width = x + quiet;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges"><path d="${bars.join("")}" fill="#000"/></svg>`
  );
}
