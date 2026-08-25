// Omnia rings mark — a port of `_RingsPainter` in the Omnia console
// (flutter_app/lib/console/ds.dart). Six concentric segmented rings, blue/navy
// alternating, three arcs each. Run: node var/brand/rings.mjs [size] → SVG on stdout.
const size = Number(process.argv[2] || 60);
const c = size / 2, R = size / 2, N = 6, w = R * 0.075, step = (R - w) / N;
const paths = [];
for (let i = 0; i < N; i++) {
  const r = R - w / 2 - i * step;
  const gap = 0.5 + i * 0.12;
  const sweep = Math.max(0.3, (2 * Math.PI) / 3 - gap);
  const col = i % 2 ? '#0A1F5C' : '#1E56E8';
  for (let s = 0; s < 3; s++) {
    const a = (s * 2 * Math.PI) / 3 + i * 0.55 - Math.PI / 2;
    const b = a + sweep;
    const f = (v) => (Math.round(v * 100) / 100).toString();
    paths.push(`<path d="M${f(c + r * Math.cos(a))} ${f(c + r * Math.sin(a))} A${f(r)} ${f(r)} 0 0 1 ${f(c + r * Math.cos(b))} ${f(c + r * Math.sin(b))}" stroke="${col}"/>`);
  }
}
const attrs = `viewBox="0 0 ${size} ${size}" fill="none" stroke-width="${Math.round(w * 100) / 100}" stroke-linecap="round"`;
if (process.argv.includes('--inner')) console.log(paths.join('\n'));
else console.log(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>\n${paths.join('\n')}\n</svg>`);
