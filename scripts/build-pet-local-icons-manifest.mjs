/**
 * Maps normalized pet names (same rules as normalizeClogItemNameForPet) to PNG filenames in public/pets/.
 * Run after adding or renaming files: node scripts/build-pet-local-icons-manifest.mjs
 */
import fs from "fs";

function stemToNormalizedKey(stem) {
  let s = stem.replace(/_\([^)]*\)$/u, "");
  s = s.replace(/_/g, " ");
  return s
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
}

const petsDir = new URL("../public/pets", import.meta.url);
const outPath = new URL("../public/data/osrs-pet-local-icons.json", import.meta.url);

if (!fs.existsSync(petsDir)) {
  process.stderr.write("Missing public/pets — add PNGs first.\n");
  process.exit(1);
}

const files = fs.readdirSync(petsDir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
const icons = {};
for (const f of files) {
  const stem = f.slice(0, -4);
  const key = stemToNormalizedKey(stem);
  if (!key) continue;
  if (!icons[key]) icons[key] = f;
}

const payload = {
  note: "nameKey → filename under /public/pets/. Regenerate: node scripts/build-pet-local-icons-manifest.mjs",
  icons,
};
fs.mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload));
process.stdout.write(`Wrote ${Object.keys(icons).length} name keys (${files.length} PNGs) → public/data/osrs-pet-local-icons.json\n`);
