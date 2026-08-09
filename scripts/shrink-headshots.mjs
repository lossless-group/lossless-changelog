// Normalize headshot source assets: square-crop, cap at 256px, encode webp.
// Astro derives a 96px variant for rendering; this keeps the SOURCE sane so
// unused portraits don't ship as 700KB PNGs just for being in the glob.
import sharp from 'sharp';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, parse } from 'node:path';

const DIR = process.argv[2];
const MAX = 256;
let before = 0, after = 0;

for (const f of readdirSync(DIR)) {
  if (!/\.(jpe?g|png)$/i.test(f)) continue;
  const src = join(DIR, f);
  const out = join(DIR, parse(f).name + '.webp');
  const sz = statSync(src).size;
  before += sz;
  await sharp(src)
    .resize(MAX, MAX, { fit: 'cover', position: 'attention', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(out);
  const nsz = statSync(out).size;
  after += nsz;
  unlinkSync(src);
  console.log(`${f.padEnd(42)} ${String(Math.round(sz/1024)).padStart(4)}KB → ${String(Math.round(nsz/1024)).padStart(3)}KB`);
}
console.log(`\ntotal ${Math.round(before/1024)}KB → ${Math.round(after/1024)}KB (${(100-after/before*100).toFixed(1)}% smaller)`);
