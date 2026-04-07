/**
 * Builds public/data/osrs-pet-collection-log.json from RuneLite ItemID.java (repo root).
 * Run: node scripts/build-osrs-pet-data.mjs
 */
import fs from "fs";
const itemPath = new URL("../ItemID.java", import.meta.url);
const t = fs.readFileSync(itemPath, "utf8");
const lineRe = /^\tpublic static final int ([A-Z0-9_]+) = (\d+);/gm;
const ids = new Set();
let m;
while ((m = lineRe.exec(t))) {
  const name = m[1];
  const id = Number(m[2]);
  if (name === "PET_LIST") continue;
  if (name.startsWith("PET_KITTEN") || name.startsWith("PET_CAT")) continue;
  if (name.startsWith("PET_")) {
    ids.add(id);
    continue;
  }
  if (
    name === "BABY_MOLE" ||
    name === "KALPHITE_PRINCESS" ||
    name === "PRINCE_BLACK_DRAGON" ||
    name.startsWith("KALPHITE_PRINCESS_") ||
    name.startsWith("VENENATIS_SPIDERLING") ||
    name.startsWith("CALLISTO_CUB") ||
    name.startsWith("VETION_JR") ||
    name === "SCORPIAS_OFFSPRING" ||
    name === "TZREKJAD" ||
    name === "TZREKZUK" ||
    name === "ABYSSAL_ORPHAN" ||
    name.startsWith("ROCK_GOLEM") ||
    name.startsWith("BEAVER") ||
    name === "BLOODHOUND" ||
    name === "GIANT_SQUIRREL" ||
    name.startsWith("TANGLEROOT") ||
    name === "ROCKY" ||
    name.startsWith("RIFT_GUARDIAN") ||
    name === "PHOENIX" ||
    name.startsWith("PHOENIX_2448") ||
    name === "OLMLET" ||
    name === "VORKI" ||
    name === "LIL_ZIK" ||
    name.startsWith("SRARACHA") ||
    name === "SMOLCANO" ||
    name === "CHOMPY_CHICK" ||
    name === "HERBI" ||
    name === "PET_CORPOREAL_CRITTER" ||
    name.startsWith("LIL_CREATOR") ||
    name.startsWith("LIL_DESTRUCTOR") ||
    name.startsWith("LIL_MAIDEN") ||
    name.startsWith("LIL_BLOAT") ||
    name.startsWith("LIL_NYLO") ||
    name.startsWith("LIL_SOT") ||
    name.startsWith("LIL_XARP") ||
    name === "NEXLING" ||
    name === "PRINCELY_MONKEY" ||
    name === "BABY_MOLERAT" ||
    name === "WISP" ||
    name === "BUTCH" ||
    name === "BARON" ||
    name === "MOXI" ||
    name === "SKOTOS" ||
    name === "HELLPUPPY" ||
    name === "NOON" ||
    name === "JALNIBREK" ||
    name.startsWith("PET_SNAKELING") ||
    name.startsWith("BABY_CHINCHOMPA") ||
    name.startsWith("IKKLE_HYDRA") ||
    name === "YOUNGLLEF" ||
    name === "CORRUPTED_YOUNGLLEF" ||
    name === "LITTLE_NIGHTMARE" ||
    name === "TINY_TEMPOR" ||
    name === "HERON" ||
    name === "ABYSSAL_PROTECTOR"
  ) {
    if (name.startsWith("BEAVER") && name !== "BEAVER" && !/^BEAVER_(282|312)/.test(name)) continue;
    if (name.startsWith("PHOENIX") && name !== "PHOENIX" && !name.startsWith("PHOENIX_2448")) continue;
    ids.add(id);
  }
}

const displayNames = [
  "Abyssal orphan",
  "Ikkle hydra",
  "Callisto cub",
  "Hellpuppy",
  "Pet chaos elemental",
  "Pet zilyana",
  "Pet dark core",
  "Pet dagannoth prime",
  "Pet dagannoth supreme",
  "Pet dagannoth rex",
  "Tzrek-jad",
  "Pet general graardor",
  "Baby mole",
  "Noon",
  "Jal-nib-rek",
  "Kalphite princess",
  "Prince black dragon",
  "Pet kraken",
  "Pet kree'arra",
  "Pet k'ril tsutsaroth",
  "Scorpia's offspring",
  "Skotos",
  "Pet smoke devil",
  "Venenatis spiderling",
  "Vet'ion jr.",
  "Vorki",
  "Phoenix",
  "Pet snakeling",
  "Olmlet",
  "Lil' zik",
  "Bloodhound",
  "Pet penance queen",
  "Heron",
  "Rock golem",
  "Beaver",
  "Baby chinchompa",
  "Giant squirrel",
  "Tangleroot",
  "Rocky",
  "Rift guardian",
  "Herbi",
  "Chompy chick",
  "Sraracha",
  "Smolcano",
  "Youngllef",
  "Little nightmare",
  "Lil' creator",
  "Tiny tempor",
  "Nexling",
  "Abyssal protector",
  "Tzrek-zuk",
  "Corporeal critter",
  "Pet rock",
];

const out = {
  itemIds: [...ids].sort((a, b) => a - b),
  names: displayNames,
};
const dest = new URL("../public/data/osrs-pet-collection-log.json", import.meta.url);
fs.mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
process.stdout.write(`Wrote ${out.itemIds.length} ids, ${out.names.length} names → public/data/osrs-pet-collection-log.json\n`);
