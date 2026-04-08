(function () {
  let cachedCompetitions = [];
  let cachedCalendarEvents = [];

  function initialCalendarCursor() {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  }
  let calendarCursor = initialCalendarCursor();

  function closeMobileNav() {
    const nav = document.querySelector(".nav");
    const toggle = document.querySelector(".nav-toggle");
    if (!nav || !nav.classList.contains("is-open")) return;
    nav.classList.remove("is-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  const DISCORD_INVITE_URL = "https://discord.gg/NTWqmhSx4U";

  const WOM_GROUP_ID = 23745;
  const WOM_API = "https://api.wiseoldman.net/v2";
  /** Same-origin proxy on dev-server / Render (see dev-server.mjs). Falls back to direct API for file://. */
  function womFetchBase() {
    try {
      if (location.protocol === "http:" || location.protocol === "https:") {
        return `${location.origin}/api/wom/v2`;
      }
    } catch {
      /* ignore */
    }
    return WOM_API;
  }

  /**
   * Root-absolute `/public/...` breaks subdirectory deploys (e.g. GitHub Pages project sites).
   * Resolve `public/...` against the directory of the current document (handles `/repo`, `/repo/`, `/repo/index.html`).
   */
  function publicAssetUrl(pathFromSiteRoot) {
    const rel = String(pathFromSiteRoot || "").replace(/^\/+/, "");
    try {
      const u = new URL(location.href);
      let pathname = u.pathname;
      const segments = pathname.split("/").filter(Boolean);
      const lastSeg = segments[segments.length - 1] || "";
      if (pathname !== "/" && !pathname.endsWith("/") && /\.(html?|php|aspx|json)$/i.test(lastSeg)) {
        pathname = pathname.slice(0, pathname.lastIndexOf("/") + 1);
      } else if (pathname !== "/" && !pathname.endsWith("/")) {
        pathname = `${pathname}/`;
      }
      return new URL(rel, `${u.origin}${pathname}`).href;
    } catch {
      return `/${rel}`;
    }
  }

  /** OSRS clan rank titles → filename in public/clan-ranks/ (RuneLite / Discord art). */
  const CLAN_RANK_ICON_FILE = {
    administrator: "Administrator.png",
    admiral: "Admiral.png",
    armadylean: "Armadylean.png",
    bandosian: "Bandosian.png",
    brigadier: "Brigadier.png",
    cadet: "Cadet.png",
    captain: "Captain.png",
    colonel: "Colonel.png",
    commander: "Commander.png",
    corporal: "Corporal.png",
    "deputy owner": "Deputy Owner.png",
    general: "General.png",
    guthixian: "Guthixian.png",
    lieutenant: "Lieutenant.png",
    marshal: "Marshal.png",
    novice: "Novice.png",
    officer: "Officer.png",
    owner: "Owner.png",
    recruit: "Recruit.png",
    saradominist: "Saradominist.png",
    serenist: "Serenist.png",
    sergeant: "Sergeant.png",
    xerician: "Xerician.png",
    zamorakian: "Zamorakian.png",
    zarosian: "Zarosian.png",
  };

  function clanRankIconSrc(rankTitle) {
    const k = String(rankTitle || "")
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'");
    const file = CLAN_RANK_ICON_FILE[k];
    if (!file) return "";
    return publicAssetUrl(`public/clan-ranks/${encodeURIComponent(file)}`);
  }

  /** RuneProfile `accountType.key` / `.name` → PNG in public/account-type-icons/. */
  const ACCOUNT_TYPE_ICON_FILE = {
    ironman: "Ironman.png",
    hardcore_ironman: "Hardcore ironman.png",
    hardcore: "Hardcore ironman.png",
    hcim: "Hardcore ironman.png",
    ultimate_ironman: "Ultimate ironman.png",
    ultimate: "Ultimate ironman.png",
    uim: "Ultimate ironman.png",
    group_ironman: "Group Ironman.png",
    hardcore_group_ironman: "Hardcore group Ironman.png",
    hardcore_group: "Hardcore group Ironman.png",
    unranked_group_ironman: "Unranked group Ironman.png",
    unranked_group: "Unranked group Ironman.png",
  };

  const ACCOUNT_TYPE_ICON_BY_LABEL = {
    ironman: "Ironman.png",
    "hardcore ironman": "Hardcore ironman.png",
    "ultimate ironman": "Ultimate ironman.png",
    "group ironman": "Group Ironman.png",
    "hardcore group ironman": "Hardcore group Ironman.png",
    "unranked group ironman": "Unranked group Ironman.png",
  };

  function accountTypeIconSrc(accountType) {
    if (!accountType) return "";
    const key = String(accountType.key || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");
    let file = ACCOUNT_TYPE_ICON_FILE[key] || "";
    if (!file) {
      const name = String(accountType.name || "")
        .trim()
        .toLowerCase()
        .replace(/\u2019/g, "'");
      file = ACCOUNT_TYPE_ICON_BY_LABEL[name] || "";
    }
    if (!file) return "";
    return publicAssetUrl(`public/account-type-icons/${encodeURIComponent(file)}`);
  }

  function setMemberAccountTypeIcon(accountType, typeNameForAlt) {
    const el = document.getElementById("member-account-type-icon");
    if (!el) return;
    const src = accountTypeIconSrc(accountType);
    if (!src) {
      el.removeAttribute("src");
      el.hidden = true;
      el.alt = "";
      return;
    }
    el.src = src;
    el.alt = typeNameForAlt ? `${String(typeNameForAlt).trim()} account type` : "Account type";
    el.hidden = false;
  }

  function womRetryDelay(attemptIndex) {
    if (attemptIndex <= 0) return 0;
    return attemptIndex === 1 ? 450 : 1100;
  }

  function womLoadErrorHint(err) {
    try {
      if (location.protocol === "file:") {
        return "Open this site with npm start or your https URL — not a local file — so the Wise Old Man proxy can run.";
      }
    } catch {
      /* ignore */
    }
    const m =
      err && typeof err.message === "string"
        ? err.message
        : typeof err === "string"
          ? err
          : "";
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
      return "Could not reach the site server or Wise Old Man. Check your connection and try again.";
    }
    const http = m.match(/: (\d{3})$/);
    if (http) {
      return `Wise Old Man returned HTTP ${http[1]}. Try again in a moment.`;
    }
    return `Could not load Wise Old Man (${m || "error"}). Try again.`;
  }

  const WOM_GROUP_URL = `https://wiseoldman.net/groups/${WOM_GROUP_ID}`;
  /** Matches WOM API Boss metric enum — each has group hiscores with per-player kill counts. */
  const WOM_BOSS_METRICS = [
    "abyssal_sire",
    "alchemical_hydra",
    "amoxliatl",
    "araxxor",
    "artio",
    "barrows_chests",
    "brutus",
    "bryophyta",
    "callisto",
    "calvarion",
    "cerberus",
    "chambers_of_xeric",
    "chambers_of_xeric_challenge_mode",
    "chaos_elemental",
    "chaos_fanatic",
    "commander_zilyana",
    "corporeal_beast",
    "crazy_archaeologist",
    "dagannoth_prime",
    "dagannoth_rex",
    "dagannoth_supreme",
    "deranged_archaeologist",
    "doom_of_mokhaiotl",
    "duke_sucellus",
    "general_graardor",
    "giant_mole",
    "grotesque_guardians",
    "hespori",
    "kalphite_queen",
    "king_black_dragon",
    "kraken",
    "kreearra",
    "kril_tsutsaroth",
    "lunar_chests",
    "mimic",
    "nex",
    "nightmare",
    "phosanis_nightmare",
    "obor",
    "phantom_muspah",
    "sarachnis",
    "scorpia",
    "scurrius",
    "shellbane_gryphon",
    "skotizo",
    "sol_heredit",
    "spindel",
    "tempoross",
    "the_gauntlet",
    "the_corrupted_gauntlet",
    "the_hueycoatl",
    "the_leviathan",
    "the_royal_titans",
    "the_whisperer",
    "theatre_of_blood",
    "theatre_of_blood_hard_mode",
    "thermonuclear_smoke_devil",
    "tombs_of_amascut",
    "tombs_of_amascut_expert",
    "tzkal_zuk",
    "tztok_jad",
    "vardorvis",
    "venenatis",
    "vetion",
    "vorkath",
    "wintertodt",
    "yama",
    "zalcano",
    "zulrah",
  ];
  const MS_DAY = 86400000;
  const RP_BASES = ["https://api.runeprofile.com", "/rp-api"];
  const JAGEX_ITEM_API = "https://secure.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json";
  const itemNameCache = new Map();
  const itemIconCache = new Map();
  const SKILL_SORT = [
    "Attack",
    "Defence",
    "Strength",
    "Hitpoints",
    "Ranged",
    "Prayer",
    "Magic",
    "Cooking",
    "Woodcutting",
    "Fletching",
    "Fishing",
    "Firemaking",
    "Crafting",
    "Smithing",
    "Mining",
    "Herblore",
    "Agility",
    "Thieving",
    "Slayer",
    "Farming",
    "Runecraft",
    "Runecrafting",
    "Hunter",
    "Construction",
    "Sailing",
  ];

  /** Matches RuneLite `Skill` enum / hiscores column order (used as `skillId` on RuneProfile `level_up`). */
  const OSRS_SKILL_BY_INDEX = [
    "Attack",
    "Defence",
    "Strength",
    "Hitpoints",
    "Ranged",
    "Prayer",
    "Magic",
    "Cooking",
    "Woodcutting",
    "Fletching",
    "Fishing",
    "Firemaking",
    "Crafting",
    "Smithing",
    "Mining",
    "Herblore",
    "Agility",
    "Thieving",
    "Slayer",
    "Farming",
    "Runecraft",
    "Hunter",
    "Construction",
    "Sailing",
  ];

  function skillSortKey(name) {
    const i = SKILL_SORT.indexOf(name);
    return i === -1 ? 999 : i;
  }

  /** In-game stats tab order (left→right, top→bottom, 3 columns). */
  const SKILL_STATS_TAB_ORDER = [
    "Attack",
    "Hitpoints",
    "Mining",
    "Strength",
    "Agility",
    "Smithing",
    "Defence",
    "Herblore",
    "Fishing",
    "Ranged",
    "Thieving",
    "Cooking",
    "Prayer",
    "Crafting",
    "Firemaking",
    "Magic",
    "Fletching",
    "Woodcutting",
    "Runecraft",
    "Slayer",
    "Farming",
    "Construction",
    "Hunter",
    "Sailing",
  ];

  const WIKI_SKILL_ICON_BASE = "https://oldschool.runescape.wiki/images/";

  /** Canonical skill name → OSRS Wiki `*_icon.png` filename. */
  const SKILL_ICON_FILE = {
    Attack: "Attack_icon.png",
    Hitpoints: "Hitpoints_icon.png",
    Mining: "Mining_icon.png",
    Strength: "Strength_icon.png",
    Agility: "Agility_icon.png",
    Smithing: "Smithing_icon.png",
    Defence: "Defence_icon.png",
    Herblore: "Herblore_icon.png",
    Fishing: "Fishing_icon.png",
    Ranged: "Ranged_icon.png",
    Thieving: "Thieving_icon.png",
    Cooking: "Cooking_icon.png",
    Prayer: "Prayer_icon.png",
    Crafting: "Crafting_icon.png",
    Firemaking: "Firemaking_icon.png",
    Magic: "Magic_icon.png",
    Fletching: "Fletching_icon.png",
    Woodcutting: "Woodcutting_icon.png",
    Runecraft: "Runecraft_icon.png",
    Slayer: "Slayer_icon.png",
    Farming: "Farming_icon.png",
    Construction: "Construction_icon.png",
    Hunter: "Hunter_icon.png",
    Sailing: "Sailing_icon.png",
  };

  const LOCAL_SKILL_CAPE_FILE = {
    Attack: "Attack_cape(t).png",
    Hitpoints: "Hitpoints_cape(t).png",
    Mining: "Mining_cape(t).png",
    Strength: "Strength_cape(t).png",
    Agility: "Agility_cape(t).png",
    Smithing: "Smithing_cape(t).png",
    Defence: "Defence_cape(t).png",
    Herblore: "Herblore_cape(t).png",
    Fishing: "Fishing_cape(t).png",
    Ranged: "Ranging_cape(t).png",
    Thieving: "Thieving_cape(t).png",
    Cooking: "Cooking_cape(t).png",
    Prayer: "Prayer_cape(t).png",
    Crafting: "Crafting_cape(t).png",
    Firemaking: "Firemaking_cape(t).png",
    Magic: "Magic_cape(t).png",
    Fletching: "Fletching_cape(t).png",
    Woodcutting: "Woodcut._cape(t).png",
    Runecraft: "Runecraft_cape(t).png",
    Slayer: "Slayer_cape(t).png",
    Farming: "Farming_cape(t).png",
    Construction: "Construct._cape(t).png",
    Hunter: "Hunter_cape(t).png",
    Sailing: "Sailing_cape(t).png",
  };

  function normalizeSkillName(name) {
    const n = String(name || "").trim();
    if (n === "Runecrafting") return "Runecraft";
    return n;
  }

  function skillStatsTabSortKey(name) {
    const n = normalizeSkillName(name);
    const i = SKILL_STATS_TAB_ORDER.indexOf(n);
    return i === -1 ? 999 : i;
  }

  function skillIconSrc(name) {
    const n = normalizeSkillName(name);
    const file = SKILL_ICON_FILE[n];
    if (!file) return "";
    return `${WIKI_SKILL_ICON_BASE}${file}`;
  }

  function skillCapeIconSrc(name) {
    const n = normalizeSkillName(name);
    if (!n) return "";
    const localFile = LOCAL_SKILL_CAPE_FILE[n];
    if (localFile) return publicAssetUrl(`public/skill-capes/${encodeURIComponent(localFile)}`);
    // Fallback to wiki naming.
    return `${WIKI_SKILL_ICON_BASE}${encodeURIComponent(`${n}_cape(t).png`)}`;
  }

  const DIARY_TIER_ORDER = ["Easy", "Medium", "Hard", "Elite", "Master"];

  function diaryTierSortKey(tierName) {
    const i = DIARY_TIER_ORDER.indexOf(String(tierName || "").trim());
    return i === -1 ? 50 : i;
  }

  /** True when every achievement diary tier row with tasks is fully complete (all regions / tiers like Easy–Elite). */
  function allAchievementDiaryTiersComplete(diaries) {
    if (!diaries || !diaries.length) return false;
    let anyTasks = false;
    for (const d of diaries) {
      const tc = d.tasksCount || 0;
      const cc = d.completedCount || 0;
      if (tc > 0) {
        anyTasks = true;
        if (cc < tc) return false;
      }
    }
    return anyTasks;
  }

  function achievementDiaryCapeIconSrc() {
    return publicAssetUrl(`public/skill-capes/${encodeURIComponent("Achievement_diary_cape_(t).png")}`);
  }

  function questPointCapeIconSrc() {
    return publicAssetUrl(`public/skill-capes/${encodeURIComponent("Quest_point_cape_(t).png")}`);
  }

  function maxCapeIconSrc() {
    return publicAssetUrl(`public/skill-capes/${encodeURIComponent("Max_cape.png")}`);
  }

  /** True when every skill on the stats tab (incl. Sailing) is level 99+ from synced XP. */
  function allStatsTabSkillsAtLeast99(skillsRows) {
    const byName = new Map();
    for (const s of skillsRows || []) {
      const k = normalizeSkillName(s.name);
      byName.set(k, s.xp || 0);
    }
    for (const name of SKILL_STATS_TAB_ORDER) {
      const xp = byName.get(name) ?? 0;
      if (levelFromXp(xp) < 99) return false;
    }
    return true;
  }

  /** Every main quest (RuneProfile type !== 2) finished; excludes miniquests. */
  function allMainQuestsComplete(mainQuests) {
    if (!mainQuests || !mainQuests.length) return false;
    return mainQuests.every((q) => Number(q.state) === 2);
  }

  const COMBAT_TIER_ORDER = ["Easy", "Medium", "Hard", "Elite", "Master", "Grandmaster"];

  function combatTierSortKey(name) {
    const raw = String(name || "").trim();
    let i = COMBAT_TIER_ORDER.indexOf(raw);
    if (i === -1) {
      const lower = raw.toLowerCase();
      i = COMBAT_TIER_ORDER.findIndex((t) => t.toLowerCase() === lower);
    }
    return i === -1 ? 50 : i;
  }

  const COMBAT_HILT_FILES = {
    easy: "easy.png",
    medium: "medium.png",
    hard: "hard.png",
    elite: "elite.png",
    master: "master.png",
    grandmaster: "grandmaster.png",
  };

  /** Ghommal hilt art per combat achievement tier (matches `combatAchievementTiers[].name`). */
  function combatHiltIconSrc(tierLabel) {
    const k = String(tierLabel || "").trim().toLowerCase();
    const file = COMBAT_HILT_FILES[k];
    if (!file) return "";
    return publicAssetUrl(`public/combat-hilts/${encodeURIComponent(file)}`);
  }

  /** Highest tier fully complete (Easy→Grandmaster); one badge upgrades as higher tiers are finished. */
  function highestCompletedCombatTierName(combatTiers) {
    if (!combatTiers || !combatTiers.length) return "";
    const sorted = [...combatTiers].sort((a, b) => combatTierSortKey(a.name) - combatTierSortKey(b.name));
    let last = "";
    for (const t of sorted) {
      const tc = t.tasksCount || 0;
      const cc = t.completedCount || 0;
      if (tc > 0 && cc >= tc) last = String(t.name || "").trim();
    }
    return last;
  }

  /**
   * One diary-style region card: title, aggregate bar, tier pills. `nameField` is `tierName` or `name`.
   * @param {(label: string) => string} [tierIconSrcForLabel] If set, prepends an icon (e.g. combat hilts).
   */
  function buildDiaryStyleRegionHtml(title, tierRows, nameField, tierIconSrcForLabel) {
    let done = 0;
    let total = 0;
    for (const t of tierRows) {
      done += t.completedCount || 0;
      total += t.tasksCount || 0;
    }
    const pct = total ? Math.min(100, (100 * done) / total) : 0;
    const pills = tierRows
      .map((t) => {
        const tc = t.tasksCount || 0;
        const cc = t.completedCount || 0;
        const complete = tc > 0 && cc >= tc;
        const label = t[nameField] ?? "?";
        const iconSrc = tierIconSrcForLabel ? tierIconSrcForLabel(String(label)) : "";
        const iconHtml = iconSrc
          ? `<img class="member-diary-tier-icon" src="${escHtml(iconSrc)}" alt="" width="22" height="22" loading="lazy" decoding="async" />`
          : "";
        const pillExtra = iconHtml ? " member-diary-tier-pill--with-icon" : "";
        return `<span class="member-diary-tier-pill${complete ? " is-complete" : ""}${pillExtra}">${iconHtml}${escHtml(String(label))} ${cc}/${tc}</span>`;
      })
      .join("");
    return `<article class="member-diary-region">
  <div class="member-diary-region-head">
    <span class="member-diary-region-name">${escHtml(title)}</span>
    <span class="member-diary-region-total">${done}/${total}</span>
  </div>
  <div class="member-ca-bar member-diary-region-bar"><div class="member-ca-fill" style="width:${pct.toFixed(1)}%"></div></div>
  <div class="member-diary-tier-strip">${pills}</div>
</article>`;
  }

  function xpForLevel(level) {
    let total = 0;
    for (let L = 1; L < level; L++) total += Math.floor(L + 300 * Math.pow(2, L / 7));
    return Math.floor(total / 4);
  }

  function levelFromXp(xp) {
    let lvl = 1;
    while (lvl < 200 && xp >= xpForLevel(lvl + 1)) lvl++;
    return lvl;
  }

  function memberProfileHref(username) {
    return `#/members/${encodeURIComponent(username)}`;
  }

  async function fetchRuneProfileBySlug(slug) {
    const decoded = decodeURIComponent(slug.replace(/\+/g, " "));
    const candidates = [decoded.trim(), decoded.trim().replace(/-/g, " ")].filter((v, i, a) => v && a.indexOf(v) === i);
    for (const name of candidates) {
      for (const base of RP_BASES) {
        try {
          const r = await fetch(`${base}/profiles/${encodeURIComponent(name)}`, {
            headers: { Accept: "application/json" },
          });
          if (r.ok) return r.json();
        } catch (_) {
          /* CORS or network */
        }
      }
    }
    return null;
  }

  function formatGp(n) {
    const x = Number(n) || 0;
    if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B gp`;
    if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M gp`;
    if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K gp`;
    return `${x.toLocaleString()} gp`;
  }

  async function resolveOsrsItemName(itemId) {
    const key = String(itemId);
    if (itemNameCache.has(key)) return itemNameCache.get(key);
    const urls = [publicAssetUrl(`rs-item/${key}`), `${JAGEX_ITEM_API}?item=${encodeURIComponent(key)}`];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        const txt = await r.text();
        if (!txt.trim().startsWith("{")) continue;
        const j = JSON.parse(txt);
        if (j.item && j.item.name) {
          itemNameCache.set(key, j.item.name);
          return j.item.name;
        }
      } catch (_) {
        /* CORS, parse error, or network */
      }
    }
    const fb = `Item #${key}`;
    itemNameCache.set(key, fb);
    return fb;
  }

  async function hydrateOsrsItemNames(root) {
    if (!root) return;
    const els = root.querySelectorAll("[data-osrs-item]");
    const ids = [...new Set([...els].map((el) => el.getAttribute("data-osrs-item")).filter(Boolean))];
    await Promise.all(
      ids.map(async (id) => {
        const label = await resolveOsrsItemName(id);
        root.querySelectorAll(`[data-osrs-item="${id}"]`).forEach((el) => {
          el.textContent = label;
        });
      })
    );
  }

  /** Jagex catalogue often returns relative icon URLs; img.src needs an absolute or data URL. */
  function absolutizeRunescapeCatalogueIcon(icon) {
    if (!icon || typeof icon !== "string") return "";
    const t = icon.trim();
    if (!t) return "";
    if (t.startsWith("data:") || /^https?:\/\//i.test(t)) return t;
    if (t.startsWith("//")) return `https:${t}`;
    if (t.startsWith("/")) return `https://secure.runescape.com${t}`;
    return t;
  }

  /** OSRSBox item JSON includes base64 PNG (works when Jagex/CORS and /rs-item name-only fallbacks omit icons). */
  async function resolveOsrsItemIconFromOsrsbox(itemId) {
    const key = String(itemId);
    const url = `https://raw.githubusercontent.com/osrsbox/osrsbox-db/master/docs/items-json/${key}.json`;
    try {
      const r = await fetch(url);
      if (!r.ok) return "";
      const j = await r.json();
      const b64 = j && typeof j.icon === "string" ? j.icon.replace(/\s/g, "") : "";
      if (b64.length > 40) return `data:image/png;base64,${b64}`;
    } catch (_) {
      /* network */
    }
    return "";
  }

  /** Catalogue `icon` / `icon_large`, then OSRSBox embedded icon. */
  async function resolveOsrsItemIcon(itemId) {
    const key = String(itemId);
    if (itemIconCache.has(key)) return itemIconCache.get(key);
    const urls = [publicAssetUrl(`rs-item/${key}`), `${JAGEX_ITEM_API}?item=${encodeURIComponent(key)}`];
    for (const u of urls) {
      try {
        const r = await fetch(u);
        const txt = await r.text();
        if (!txt.trim().startsWith("{")) continue;
        const j = JSON.parse(txt);
        const raw = j.item && (j.item.icon_large || j.item.icon);
        const icon = absolutizeRunescapeCatalogueIcon(raw);
        if (icon) {
          itemIconCache.set(key, icon);
          return icon;
        }
      } catch (_) {
        /* CORS, parse error, or network */
      }
    }
    const fromBox = await resolveOsrsItemIconFromOsrsbox(key);
    if (fromBox) {
      itemIconCache.set(key, fromBox);
      return fromBox;
    }
    itemIconCache.set(key, "");
    return "";
  }

  async function hydrateOsrsPetIcons(root) {
    if (!root) return;
    const slots = root.querySelectorAll(".member-pet-icon-slot[data-pet-name], .member-pet-icon-slot[data-item-id]");
    await Promise.all(
      [...slots].map(async (slot) => {
        const id = slot.getAttribute("data-item-id");
        const displayName = slot.getAttribute("data-pet-name") || "";
        const img = slot.querySelector(".member-pet-icon");
        const fb = slot.querySelector(".member-pet-fallback");
        if (!img || (!id && !displayName)) return;
        const showIcon = () => {
          img.hidden = false;
          if (fb) fb.hidden = true;
        };
        const showFallback = () => {
          img.hidden = true;
          if (fb) fb.hidden = false;
        };
        try {
          const url = await resolveMemberPetIcon(id, displayName);
          if (!url) {
            showFallback();
            return;
          }
          img.onload = showIcon;
          img.onerror = showFallback;
          img.src = url;
          if (img.complete && img.naturalWidth > 0) showIcon();
        } catch (_) {
          showFallback();
        }
      })
    );
  }

  function titleCaseMetric(s) {
    const t = String(s).trim();
    if (!t) return "";
    return t
      .replace(/_/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function resolveLevelUpSkillName(d) {
    const named = d.skill ?? d.skillName;
    if (named != null && String(named).trim() && String(named).trim() !== "?") return String(named).trim();
    if (d.metric != null && String(d.metric).trim()) {
      const m = titleCaseMetric(d.metric);
      if (m) return m;
    }
    const rawId = d.skillId ?? d.skillID;
    if (rawId != null && rawId !== "") {
      const id = typeof rawId === "number" ? rawId : parseInt(String(rawId), 10);
      if (!Number.isNaN(id) && id >= 0 && id < OSRS_SKILL_BY_INDEX.length) return OSRS_SKILL_BY_INDEX[id];
    }
    return "?";
  }

  function humanizeSnakeType(type) {
    if (!type) return "Activity";
    return String(type)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function buildQuestNamesById(quests) {
    const map = new Map();
    for (const q of quests || []) {
      const id = q.id ?? q.questId;
      const name = q.name ?? q.title ?? q.questName;
      if (id == null || !name) continue;
      const n = Number(id);
      if (!Number.isNaN(n)) map.set(n, String(name));
    }
    return map;
  }

  /** RuneProfile `quests[].type`: 0 = F2P quest, 1 = members quest, 2 = miniquest (exclude from main quest totals). */
  function runeProfileMainQuestsOnly(quests) {
    return (quests || []).filter((q) => q && q.type !== 2);
  }

  let osrsPetClogMetaCache = null;
  let osrsPetClogMetaPromise = null;

  /** Loads pet item IDs + display names for matching RuneProfile collection log `items`. */
  function loadOsrsPetCollectionLogMeta() {
    if (osrsPetClogMetaCache) return Promise.resolve(osrsPetClogMetaCache);
    if (!osrsPetClogMetaPromise) {
      osrsPetClogMetaPromise = fetch(publicAssetUrl("public/data/osrs-pet-collection-log.json"))
        .then((r) => (r.ok ? r.json() : { itemIds: [], names: [] }))
        .then((j) => {
          const itemIds = new Set((j.itemIds || []).map(Number));
          const names = new Set(
            (j.names || []).map((n) =>
              String(n || "")
                .trim()
                .replace(/\u2019/g, "'")
                .toLowerCase()
            )
          );
          osrsPetClogMetaCache = { itemIds, names };
          return osrsPetClogMetaCache;
        })
        .catch(() => {
          osrsPetClogMetaCache = { itemIds: new Set(), names: new Set() };
          return osrsPetClogMetaCache;
        });
    }
    return osrsPetClogMetaPromise;
  }

  let petLocalIconsMapCache = null;
  let petLocalIconsPromise = null;

  /** PNGs in /public/pets/ keyed by normalizeClogItemNameForPet (see osrs-pet-local-icons.json). */
  function loadPetLocalIconsManifest() {
    if (petLocalIconsMapCache) return Promise.resolve(petLocalIconsMapCache);
    if (!petLocalIconsPromise) {
      petLocalIconsPromise = fetch(publicAssetUrl("public/data/osrs-pet-local-icons.json"))
        .then((r) => (r.ok ? r.json() : { icons: {} }))
        .then((j) => {
          petLocalIconsMapCache = j.icons && typeof j.icons === "object" ? j.icons : {};
          return petLocalIconsMapCache;
        })
        .catch(() => {
          petLocalIconsMapCache = {};
          return petLocalIconsMapCache;
        });
    }
    return petLocalIconsPromise;
  }

  function normalizeClogItemNameForPet(name) {
    return String(name || "")
      .trim()
      .replace(/\u2019/g, "'")
      .toLowerCase();
  }

  async function resolveMemberPetIcon(itemId, displayName) {
    const icons = await loadPetLocalIconsManifest();
    const key = normalizeClogItemNameForPet(displayName);
    const localFile = key && icons[key];
    if (localFile) return publicAssetUrl(`public/pets/${encodeURIComponent(localFile)}`);
    const idStr = itemId != null && itemId !== "" ? String(itemId) : "";
    if (idStr) return resolveOsrsItemIcon(idStr);
    return "";
  }

  /** RuneProfile `items[]`: collection log rows `{ id, name, quantity?, createdAt? }`. */
  function petsFromRuneProfileCollectionItems(items, petMeta) {
    const { itemIds, names } = petMeta;
    const out = [];
    const seen = new Set();
    for (const it of items || []) {
      const id = Number(it.id ?? it.itemId);
      const rawName = String(it.name || "").trim();
      const nm = normalizeClogItemNameForPet(rawName);
      const byId = Number.isFinite(id) && itemIds.has(id);
      const byName = nm && names.has(nm);
      if (!byId && !byName) continue;
      const key = Number.isFinite(id) ? `i:${id}` : `n:${nm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: rawName || (Number.isFinite(id) ? `Pet (#${id})` : "Pet"),
        id: Number.isFinite(id) ? id : null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return out;
  }

  function mergeManualPetEntries(manualList, fromClog) {
    if (!manualList || !manualList.length) return fromClog;
    const seen = new Set();
    for (const p of fromClog) {
      if (p.id != null) seen.add(`i:${p.id}`);
      seen.add(`n:${normalizeClogItemNameForPet(p.name)}`);
    }
    const extra = [];
    for (const p of manualList) {
      const label =
        typeof p === "string" ? String(p).trim() : String(p.name ?? p.petName ?? p.title ?? "").trim();
      if (!label) continue;
      const rawId = typeof p === "object" && p != null ? p.itemId : undefined;
      const id = rawId != null ? Number(rawId) : NaN;
      const kId = Number.isFinite(id) ? `i:${id}` : "";
      const kName = `n:${normalizeClogItemNameForPet(label)}`;
      if (kId && seen.has(kId)) continue;
      if (seen.has(kName)) continue;
      if (kId) seen.add(kId);
      seen.add(kName);
      extra.push({ name: label, id: Number.isFinite(id) ? id : null });
    }
    return [...fromClog, ...extra].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  function formatRpActivity(row, ctx) {
    const raw = row.createdAt ? String(row.createdAt).replace(" ", "T") : "";
    const when = raw ? new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    const d = row.data || {};
    if (row.type === "valuable_drop")
      return `<time>${escHtml(when)}</time> — Valuable drop: <span class="osrs-item-name" data-osrs-item="${d.itemId}">…</span> (${escHtml(
        formatGp(d.value)
      )})`;
    if (row.type === "xp_milestone") {
      const label = (d.name && String(d.name).trim()) || resolveLevelUpSkillName(d);
      return `<time>${escHtml(when)}</time> — ${escHtml(label)} XP · ${fmtXp(d.xp || 0)}`;
    }
    if (row.type === "level_up")
      return `<time>${escHtml(when)}</time> — Level up: ${escHtml(resolveLevelUpSkillName(d))} → ${d.level ?? "?"}`;
    if (row.type === "quest_completed") {
      const qid = d.questId ?? d.quest_id ?? d.id ?? (d.quest && typeof d.quest === "object" ? d.quest.id : undefined);
      const questStr = typeof d.quest === "string" ? d.quest.trim() : "";
      let qname =
        (d.questName && String(d.questName).trim()) ||
        questStr ||
        (d.quest && typeof d.quest === "object" && d.quest.name ? String(d.quest.name).trim() : "") ||
        (d.name && String(d.name).trim()) ||
        "";
      if (!qname && ctx?.questNamesById && qid != null) {
        const n = Number(qid);
        if (!Number.isNaN(n)) qname = ctx.questNamesById.get(n) || "";
      }
      const detail = qname
        ? `: ${escHtml(qname)}`
        : qid != null && qid !== ""
          ? ` (#${escHtml(String(qid))})`
          : "";
      return `<time>${escHtml(when)}</time> — Quest completed${detail}`;
    }
    return `<time>${escHtml(when)}</time> — ${escHtml(humanizeSnakeType(row.type))}`;
  }

  function formatRpItem(row) {
    const raw = row.createdAt ? String(row.createdAt).replace(" ", "T") : "";
    const when = raw ? new Date(raw).toLocaleString(undefined, { dateStyle: "short" }) : "";
    const d = row.data || {};
    if (row.type === "new_item_obtained")
      return `<time>${escHtml(when)}</time> — Collection log <span class="osrs-item-name" data-osrs-item="${d.itemId}">…</span>`;
    return `<time>${escHtml(when)}</time> — ${escHtml(humanizeSnakeType(row.type || "?"))}`;
  }

  const ITEM_FEED_TYPES = new Set(["valuable_drop", "new_item_obtained"]);
  /** Max rows for home + member drops / collection log lists. */
  const CLAN_ITEM_FEED_LIMIT = 12;
  const ITEM_FEED_SELECTION_STORAGE_KEY = "th_item_feed_selected";

  function itemFeedRowKey(row) {
    const d = row.data || {};
    return `${row.type}:${String(row.createdAt ?? "")}:${String(d.itemId ?? "")}:${String(d.value ?? "")}`;
  }

  function readItemFeedSelectionMap() {
    try {
      const raw = sessionStorage.getItem(ITEM_FEED_SELECTION_STORAGE_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  function persistItemFeedSelection(ulId, key) {
    try {
      const m = readItemFeedSelectionMap();
      if (key == null || key === "") delete m[ulId];
      else m[ulId] = key;
      sessionStorage.setItem(ITEM_FEED_SELECTION_STORAGE_KEY, JSON.stringify(m));
    } catch {
      /* ignore */
    }
  }

  function restoreActivityLogSelectionForUl(ul) {
    if (!ul || !ul.id) return;
    ul.querySelectorAll("li.activity-log__item--selected").forEach((li) => li.classList.remove("activity-log__item--selected"));
    const key = readItemFeedSelectionMap()[ul.id];
    if (!key) return;
    for (const li of ul.querySelectorAll("li[data-item-feed-key]")) {
      if (li.getAttribute("data-item-feed-key") === key) {
        li.classList.add("activity-log__item--selected");
        break;
      }
    }
  }

  let activityLogSelectionBound = false;
  function bindActivityLogSelectionOnce() {
    if (activityLogSelectionBound) return;
    activityLogSelectionBound = true;
    document.addEventListener("click", (e) => {
      const li = e.target.closest("ul.activity-log > li");
      if (!li) return;
      const ul = li.closest("ul.activity-log");
      if (!ul || !ul.id) return;
      if (!li.querySelector(".osrs-item-name")) return;
      const key = li.getAttribute("data-item-feed-key");
      if (!key) return;

      if (li.classList.contains("activity-log__item--selected")) return;

      ul.querySelectorAll("li.activity-log__item--selected").forEach((x) => x.classList.remove("activity-log__item--selected"));
      li.classList.add("activity-log__item--selected");
      persistItemFeedSelection(ul.id, key);
    });
  }

  /** Deduped drops + collection log rows from RuneProfile (excludes level-ups, quests, etc.). */
  function mergeItemActivitiesFromProfile(profile) {
    const fromAct = (profile.recentActivities || []).filter((r) => ITEM_FEED_TYPES.has(r.type));
    const fromItems = (profile.recentItems || []).filter((r) => r.type === "new_item_obtained");
    const seen = new Set();
    const out = [];
    for (const r of [...fromAct, ...fromItems]) {
      const d = r.data || {};
      const key = `${r.type}:${String(r.createdAt)}:${String(d.itemId ?? "")}:${String(d.value ?? "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    out.sort((a, b) => {
      const ta = new Date(String(a.createdAt).replace(" ", "T")).getTime();
      const tb = new Date(String(b.createdAt).replace(" ", "T")).getTime();
      return tb - ta;
    });
    return out;
  }

  function formatMemberItemRow(row, ctx) {
    if (row.type === "new_item_obtained") return formatRpItem(row);
    if (row.type === "valuable_drop") return formatRpActivity(row, ctx);
    return "";
  }

  function formatHomeItemActivityRow(row, playerDisplay, href) {
    const raw = row.createdAt ? String(row.createdAt).replace(" ", "T") : "";
    const when = raw ? new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    const d = row.data || {};
    const idAttr = escHtml(String(d.itemId ?? ""));
    if (row.type === "valuable_drop") {
      return `<time>${escHtml(when)}</time> — <a href="${escHtml(href)}" class="wom-link">${escHtml(playerDisplay)}</a> · Drop: <span class="osrs-item-name" data-osrs-item="${idAttr}">…</span> <span class="muted">(${escHtml(formatGp(d.value))})</span>`;
    }
    if (row.type === "new_item_obtained") {
      return `<time>${escHtml(when)}</time> — <a href="${escHtml(href)}" class="wom-link">${escHtml(playerDisplay)}</a> · Collection log <span class="osrs-item-name" data-osrs-item="${idAttr}">…</span>`;
    }
    return "";
  }

  async function hydrateClanActivityItemFeed(collActivity, womFallbackHtml, actEl) {
    const candidates = collActivity.slice(0, 10);
    const profiles = await Promise.all(
      candidates.map((row) => fetchRuneProfileBySlug(row.player?.username || ""))
    );
    const flat = [];
    for (let i = 0; i < profiles.length; i++) {
      const prof = profiles[i];
      const row = candidates[i];
      if (!prof || !row?.player) continue;
      const p = row.player;
      const display = p.displayName || p.username || prof.username;
      const href = memberProfileHref(p.username || prof.username);
      for (const r of mergeItemActivitiesFromProfile(prof)) {
        flat.push({ row: r, display, href });
      }
    }
    flat.sort((a, b) => {
      const ta = new Date(String(a.row.createdAt).replace(" ", "T")).getTime();
      const tb = new Date(String(b.row.createdAt).replace(" ", "T")).getTime();
      return tb - ta;
    });
    const top = flat.slice(0, CLAN_ITEM_FEED_LIMIT);
    if (!top.length) {
      actEl.innerHTML = womFallbackHtml;
      restoreActivityLogSelectionForUl(actEl);
      return;
    }
    actEl.innerHTML = top
      .map(({ row, display, href }) => {
        const line = formatHomeItemActivityRow(row, display, href);
        if (!line) return "";
        const k = escHtml(itemFeedRowKey(row));
        return `<li data-item-feed-key="${k}">${line}</li>`;
      })
      .filter(Boolean)
      .join("");
    const root = document.getElementById("clan-activity");
    await hydrateOsrsItemNames(root);
    restoreActivityLogSelectionForUl(actEl);
  }

  let memberReqId = 0;

  function memberNavStale(navId) {
    return navId != null && navId !== memberReqId;
  }

  async function renderRuneProfile(profile, navId) {
    if (memberNavStale(navId)) return;
    const rpPage = `https://www.runeprofile.com/${encodeURIComponent(profile.username)}`;
    document.title = `${profile.username} | Terpinheimer`;
    const crumb = document.getElementById("member-crumb-name");
    if (crumb) crumb.textContent = profile.username;
    setText("member-name", profile.username);
    const typeName = profile.accountType?.name || profile.accountType?.key || "—";
    const updated = profile.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "—";
    const meta = document.getElementById("member-meta");
    if (meta) meta.textContent = `${typeName} · Last sync ${updated}`;
    setMemberAccountTypeIcon(profile.accountType, typeName);

    const rpA = document.getElementById("member-rp-link");
    if (rpA) rpA.href = rpPage;

    const petClogMeta = await loadOsrsPetCollectionLogMeta();
    if (memberNavStale(navId)) return;

    const skills = [...(profile.skills || [])].sort((a, b) => skillStatsTabSortKey(a.name) - skillStatsTabSortKey(b.name));
    const diaries = profile.achievementDiaryTiers || [];
    const ca = profile.combatAchievementTiers || [];
    const mainQuests = runeProfileMainQuestsOnly(profile.quests);
    const diaryCapeUnlocked = allAchievementDiaryTiersComplete(diaries);
    const questPointCapeUnlocked = allMainQuestsComplete(mainQuests);
    const combatTierTop = highestCompletedCombatTierName(ca);

    const clanP = document.getElementById("member-clan-panel");
    const clanB = document.getElementById("member-clan-body");
    if (profile.clan && profile.clan.name && clanP && clanB) {
      clanP.hidden = false;
      const maxCapeUnlocked = allStatsTabSkillsAtLeast99(skills);
      const maxed = skills.filter((s) => levelFromXp(s.xp || 0) >= 99);
      const badges = maxCapeUnlocked
        ? (() => {
            const src = maxCapeIconSrc();
            return src
              ? `<span class="member-skill-cape-badge member-skill-cape-badge--max" title="Max cape"><span class="member-skill-cape-frame"><img class="member-skill-cape-icon" src="${escHtml(
                  src
                )}" alt="Max cape" loading="lazy" decoding="async" /></span></span>`
              : "";
          })()
        : maxed
            .map((s) => {
              const skillName = normalizeSkillName(s.name);
              const src = skillCapeIconSrc(skillName);
              if (!src) return "";
              const lv = levelFromXp(s.xp || 0);
              const tip = `${skillName} (${lv})`;
              return `<span class="member-skill-cape-badge" title="${escHtml(tip)}"><span class="member-skill-cape-frame"><img class="member-skill-cape-icon" src="${escHtml(
                src
              )}" alt="${escHtml(skillName)} skillcape" loading="lazy" decoding="async" /></span></span>`;
            })
            .filter(Boolean)
            .join("");
      const combatTip = combatTierTop ? `Combat achievements — ${combatTierTop}` : "";
      const combatHiltSrc = combatTierTop ? combatHiltIconSrc(combatTierTop) : "";
      const combatBadge = combatHiltSrc
        ? `<span class="member-skill-cape-badge member-skill-cape-badge--combat" title="${escHtml(combatTip)}"><span class="member-skill-cape-frame"><img class="member-skill-cape-icon" src="${escHtml(
            combatHiltSrc
          )}" alt="${escHtml(combatTierTop)} combat tier" loading="lazy" decoding="async" /></span></span>`
        : "";
      const qpCapeSrc = questPointCapeIconSrc();
      const questPointBadge = questPointCapeUnlocked
        ? `<span class="member-skill-cape-badge member-skill-cape-badge--quest-point" title="Quest point cape (t)"><span class="member-skill-cape-frame"><img class="member-skill-cape-icon" src="${escHtml(
            qpCapeSrc
          )}" alt="Quest point cape (t)" loading="lazy" decoding="async" /></span></span>`
        : "";
      const diarySrc = achievementDiaryCapeIconSrc();
      const diaryBadge = diaryCapeUnlocked
        ? `<span class="member-skill-cape-badge member-skill-cape-badge--diary" title="Achievement diary cape (t)"><span class="member-skill-cape-frame"><img class="member-skill-cape-icon" src="${escHtml(
            diarySrc
          )}" alt="Achievement diary cape (t)" loading="lazy" decoding="async" /></span></span>`
        : "";
      const capeStrip = `${badges}${combatBadge}${questPointBadge}${diaryBadge}`;
      const badgesBlock = capeStrip
        ? `<span class="member-skill-capes" aria-label="Skill capes or max cape, combat, quest point, and diary milestones">${capeStrip}</span>`
        : "";
      const rankTitleRaw = profile.clan.title || "Member";
      const rankIconSrc = clanRankIconSrc(rankTitleRaw);
      const rankBlock = rankIconSrc
        ? `<span class="member-clan-rank"><img class="member-clan-rank-icon" src="${escHtml(rankIconSrc)}" alt="${escHtml(rankTitleRaw)} rank" width="22" height="22" decoding="async" /><span class="member-clan-rank-text">${escHtml(rankTitleRaw)}</span></span>`
        : escHtml(rankTitleRaw);
      clanB.innerHTML = `<span class="member-clan-summary"><span class="member-clan-main"><strong style="color:var(--cream)">${escHtml(profile.clan.name)}</strong> — ${rankBlock}</span>${badgesBlock}</span>`;
    } else if (clanP) clanP.hidden = true;
    let totalLvl = 0;
    const skillHtml = skills
      .map((s) => {
        const xp = s.xp || 0;
        const lv = levelFromXp(xp);
        totalLvl += lv;
        const iconSrc = skillIconSrc(s.name);
        const iconHtml = iconSrc
          ? `<img class="member-skill-icon" src="${escHtml(iconSrc)}" alt="" width="30" height="30" loading="lazy" decoding="async" />`
          : `<span class="member-skill-icon member-skill-icon--empty" aria-hidden="true"></span>`;
        return `<div class="member-skill">
  <div class="member-skill-body">
    <span class="member-skill-name">${escHtml(s.name)}</span>
    <span class="member-skill-lvl">${lv}</span>
    <span class="member-skill-xp">${fmtXp(xp)} XP</span>
  </div>
  ${iconHtml}
</div>`;
      })
      .join("");
    const skEl = document.getElementById("member-skills");
    if (skEl) skEl.innerHTML = skillHtml || '<p class="muted">No skills.</p>';
    const totEl = document.getElementById("member-total-level");
    if (totEl) totEl.textContent = skills.length ? `Total level: ${totalLvl}` : "";

    const petEl = document.getElementById("member-pets");
    if (petEl) {
      const fromClog = petsFromRuneProfileCollectionItems(profile.items, petClogMeta);
      const manual = Array.isArray(profile.pets)
        ? profile.pets
        : Array.isArray(profile.collectionLogPets)
          ? profile.collectionLogPets
          : [];
      const petRows = mergeManualPetEntries(manual, fromClog);
      if (petRows.length) {
        const chips = petRows
          .map((p) => {
            const title = escHtml(p.name);
            const nameAttr = title;
            const idAttr = p.id != null ? escHtml(String(p.id)) : "";
            const idPart = idAttr ? ` data-item-id="${idAttr}"` : "";
            return `<span class="member-pet-chip member-pet-chip--icon" title="${title}"><span class="member-pet-icon-slot" data-pet-name="${nameAttr}"${idPart}><img class="member-pet-icon" alt="" width="32" height="32" decoding="async" hidden /><span class="member-pet-fallback" hidden>${title}</span></span></span>`;
          })
          .join("");
        petEl.innerHTML = `<div class="member-pets-strip">${chips}</div>`;
        await hydrateOsrsPetIcons(petEl);
        if (memberNavStale(navId)) return;
      } else {
        petEl.innerHTML =
          '<p class="muted member-diary-empty">No pets found in synced collection log yet.</p>';
      }
    }

    const quests = profile.quests || [];
    const done = mainQuests.filter((q) => q.state === 2);
    const qp = done.reduce((s, q) => s + (q.points || 0), 0);
    const qpEl = document.getElementById("member-qp");
    if (qpEl) qpEl.textContent = `${done.length} / ${mainQuests.length} quests · ${qp} Quest points`;

    const dEl = document.getElementById("member-diaries");
    if (dEl) {
      if (!diaries.length) {
        dEl.innerHTML = '<p class="muted member-diary-empty">No diary data.</p>';
      } else {
        const byArea = new Map();
        for (const d of diaries) {
          const area = d.area || "?";
          if (!byArea.has(area)) byArea.set(area, []);
          byArea.get(area).push(d);
        }
        const areas = [...byArea.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        dEl.innerHTML = areas
          .map((area) => {
            const tiers = byArea.get(area).sort((a, b) => diaryTierSortKey(a.tierName) - diaryTierSortKey(b.tierName));
            return buildDiaryStyleRegionHtml(area, tiers, "tierName");
          })
          .join("");
      }
    }

    const caEl = document.getElementById("member-combat");
    if (caEl) {
      if (!ca.length) {
        caEl.innerHTML = '<p class="muted member-diary-empty">No combat achievement data.</p>';
      } else {
        const sorted = [...ca].sort((a, b) => {
          const d = combatTierSortKey(a.name) - combatTierSortKey(b.name);
          if (d !== 0) return d;
          return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
        });
        caEl.innerHTML = buildDiaryStyleRegionHtml("Overall", sorted, "name", combatHiltIconSrc);
      }
    }

    const questNamesById = buildQuestNamesById(profile.quests);
    const itemMerged = mergeItemActivitiesFromProfile(profile).slice(0, CLAN_ITEM_FEED_LIMIT);
    const rEl = document.getElementById("member-recent");
    if (rEl) {
      rEl.innerHTML = itemMerged.length
        ? itemMerged
            .map((r) => {
              const k = escHtml(itemFeedRowKey(r));
              return `<li data-item-feed-key="${k}">${formatMemberItemRow(r, { questNamesById })}</li>`;
            })
            .join("")
        : '<li class="muted">No recent drops or collection log entries. Sync RuneProfile from RuneLite to see items here (level-ups and quests are hidden).</li>';
      restoreActivityLogSelectionForUl(rEl);
    }
    const itemsSec = document.getElementById("member-items-section");
    if (itemsSec) itemsSec.hidden = true;

    const mv = document.getElementById("member-view");
    await hydrateOsrsItemNames(mv);
    if (memberNavStale(navId)) return;

    const profileContent = document.getElementById("member-profile-content");
    const notFoundHelp = document.getElementById("member-not-found-help");
    if (profileContent) profileContent.hidden = false;
    if (notFoundHelp) notFoundHelp.hidden = true;
  }

  async function openMemberPage(slug) {
    closeMobileNav();

    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (mv) mv.hidden = false;
    window.scrollTo(0, 0);

    const id = ++memberReqId;
    const profileContent = document.getElementById("member-profile-content");
    const notFoundHelp = document.getElementById("member-not-found-help");
    if (profileContent) profileContent.hidden = true;
    if (notFoundHelp) notFoundHelp.hidden = true;

    setText("member-name", "Loading…");
    setText("member-meta", "");
    setMemberAccountTypeIcon(null, "");
    const sk = document.getElementById("member-skills");
    if (sk) sk.innerHTML = "";
    const crumb = document.getElementById("member-crumb-name");
    if (crumb) crumb.textContent = decodeURIComponent(slug.replace(/\+/g, " "));

    const profile = await fetchRuneProfileBySlug(slug);
    if (id !== memberReqId) return;

    if (!profile) {
      setText("member-name", "Not found");
      setText(
        "member-meta",
        "No RuneProfile data for this name yet. Follow the steps below, or use the exact OSRS login name."
      );
      if (profileContent) profileContent.hidden = true;
      if (notFoundHelp) notFoundHelp.hidden = false;
      setMemberAccountTypeIcon(null, "");
      return;
    }

    await renderRuneProfile(profile, id);
  }

  let cachedMemberships = null;

  function showHomeView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (hv) hv.hidden = false;
    document.title = "Terpinheimer | OSRS Clan";
    void refreshHomeLiveMapPresence();
  }

  const MIN_ORGANIZER_CODE_LEN = 6;
  /** Mirrors server session cookie for POST /api/custom-events when cookies fail (mobile in-app browsers). */
  const EVENT_SESSION_STORAGE_KEY = "th_ev_sess";

  /** Mobile browsers sometimes emit a space between date and time; Date.parse needs a T. */
  function parseDatetimeLocalInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return NaN;
    const normalized = s.includes("T") ? s : s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    let ms = Date.parse(normalized);
    if (Number.isNaN(ms)) ms = Date.parse(s);
    return ms;
  }

  function getOrganizerSecretInput() {
    return String(document.getElementById("event-organizer-secret")?.value || "").trim();
  }

  function applyEventFormUnlocked(unlocked) {
    const panel = document.getElementById("event-unlock-panel");
    if (panel) panel.hidden = !!unlocked;
    renderCalendarIfVisible();
  }

  async function resolveClanEventsAuth() {
    const secret = getOrganizerSecretInput();
    if (secret.length >= MIN_ORGANIZER_CODE_LEN) return { secret };

    let stored = "";
    try {
      stored = String(sessionStorage.getItem(EVENT_SESSION_STORAGE_KEY) || "").trim();
    } catch {
      /* private mode / blocked */
    }
    if (/^\d+\.[a-f0-9]{64}$/i.test(stored)) {
      return { secret: "", sessionToken: stored };
    }

    try {
      const r = await fetch("/api/event-session", { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (j.unlocked && j.sessionToken) {
        try {
          sessionStorage.setItem(EVENT_SESSION_STORAGE_KEY, j.sessionToken);
        } catch {
          /* ignore */
        }
        return { secret: "", sessionToken: j.sessionToken };
      }
      if (j.unlocked) return { secret: "" };
    } catch {
      /* ignore */
    }
    return null;
  }

  async function refreshEventUnlockState() {
    try {
      const r = await fetch("/api/event-session", { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      applyEventFormUnlocked(!!j.unlocked);
      try {
        if (j.unlocked && j.sessionToken) {
          sessionStorage.setItem(EVENT_SESSION_STORAGE_KEY, j.sessionToken);
        } else if (!j.unlocked) {
          sessionStorage.removeItem(EVENT_SESSION_STORAGE_KEY);
        }
      } catch {
        /* ignore */
      }
    } catch {
      applyEventFormUnlocked(false);
    }
  }

  function showEventsCalendarView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (evw) evw.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Events | Terpinheimer";
    renderCalendarIfVisible();
    void refreshEventUnlockState();
  }

  function memberLetterBucket(displayName) {
    const c = (displayName || "?").trim().charAt(0).toUpperCase();
    if (/[A-Z]/.test(c)) return c;
    return "#";
  }

  function memberLetterId(letter) {
    return letter === "#" ? "members-letter-sym" : `members-letter-${letter}`;
  }

  let membersFilterBound = false;

  function applyMembersFilter() {
    const input = document.getElementById("members-filter");
    const root = document.getElementById("members-directory");
    if (!input || !root) return;
    const q = input.value.trim().toLowerCase();
    root.querySelectorAll(".members-letter-block").forEach((block) => {
      let any = false;
      block.querySelectorAll(".members-item").forEach((li) => {
        const link = li.querySelector(".members-name-link");
        const text = (link?.textContent || "").toLowerCase();
        const show = !q || text.includes(q);
        li.hidden = !show;
        if (show) any = true;
      });
      block.hidden = !any;
    });
    const empty = document.getElementById("members-filter-empty");
    if (empty) {
      const visible = [...root.querySelectorAll(".members-letter-block")].some((b) => !b.hidden);
      empty.hidden = visible || !q;
    }
  }

  function bindMembersFilter() {
    const input = document.getElementById("members-filter");
    if (!input) return;
    if (!membersFilterBound) {
      membersFilterBound = true;
      input.addEventListener("input", applyMembersFilter);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          input.value = "";
          applyMembersFilter();
        }
      });
    } else {
      applyMembersFilter();
    }
  }

  function renderMembersList() {
    const root = document.getElementById("members-directory");
    const alphaNav = document.getElementById("members-alpha-nav");
    if (!root) return;
    if (alphaNav) {
      alphaNav.innerHTML = "";
      alphaNav.hidden = true;
    }
    if (cachedMemberships === null) {
      root.innerHTML = '<p class="muted members-page-loading">Loading roster…</p>';
      return;
    }
    const sorted = [...cachedMemberships].sort((a, b) =>
      (a.player?.displayName || "").localeCompare(b.player?.displayName || "", undefined, { sensitivity: "base" })
    );
    if (!sorted.length) {
      root.innerHTML = '<p class="muted">No members listed.</p>';
      return;
    }

    const groups = new Map();
    for (const m of sorted) {
      const p = m.player;
      const name = p?.displayName || p?.username || "?";
      const L = memberLetterBucket(name);
      if (!groups.has(L)) groups.set(L, []);
      groups.get(L).push({ name, username: p?.username });
    }

    const letters = [...groups.keys()].sort((a, b) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });

    if (alphaNav && letters.length > 1) {
      alphaNav.hidden = false;
      alphaNav.innerHTML = letters
        .map((L) => {
          const id = memberLetterId(L);
          return `<button type="button" class="members-alpha-btn" data-scrollto="${id}" aria-label="Jump to letter ${L === "#" ? "other" : L}">${escHtml(L)}</button>`;
        })
        .join("");
    }

    root.innerHTML = `<p class="muted members-filter-empty" id="members-filter-empty" hidden>No members match your search.</p>${letters
      .map((L) => {
        const items = groups.get(L);
        const id = memberLetterId(L);
        const lis = items
          .map(({ name, username }) => {
            const u = username ? memberProfileHref(username) : "#/";
            return `<li class="members-item"><a href="${u}" class="members-name-link">${escHtml(name)}</a></li>`;
          })
          .join("");
        return `<section class="members-letter-block" aria-labelledby="${id}">
          <h2 class="members-letter-title" id="${id}">${escHtml(L)}</h2>
          <ul class="members-grid">${lis}</ul>
        </section>`;
      })
      .join("")}`;

    const filterInput = document.getElementById("members-filter");
    if (filterInput) filterInput.value = "";
    bindMembersFilter();
  }

  function renderMembersListIfVisible() {
    const v = document.getElementById("members-list-view");
    if (v && !v.hidden) renderMembersList();
  }

  function showMembersListView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (listv) listv.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Members | Terpinheimer";
    renderMembersList();
  }

  const BINGO_STORAGE_KEY = "terpinheimer_bingo_board_v2";
  const BINGO_LEGACY_KEY = "terpinheimer_bingo_board_v1";
  const BINGO_TINTS = ["neutral", "easy", "mass", "hard"];
  const BINGO_MIN_DIM = 3;
  const BINGO_MAX_DIM = 10;
  /** Multiple item picks in one tile are stored in `item` joined by this character (not used in OSRS item names). */
  const BINGO_ITEM_LIST_SEP = "|";
  const BINGO_ITEM_FIELD_MAX = 2000;
  const BINGO_TEAM_COUNT_MAX = 12;
  const BINGO_TEAM_NAME_MAX = 80;
  const BINGO_TEAM_CAPTAIN_MAX = 80;
  const BINGO_TEAM_MEMBERS_MAX = 2000;
  const BINGO_SIGNUPS_STORAGE_KEY = "terpinheimer_bingo_signups_v1";
  const BINGO_ADVANCED_OPEN_KEY = "terpinheimer_bingo_advanced_open_v1";
  const BINGO_SIGNUP_NAME_MAX = 32;
  const BINGO_MAX_IMAGE_CHARS = 480000;
  const BINGO_BOARD_STATUSES = ["development", "active", "finished"];
  const BINGO_BOARD_STATUS_LABELS = {
    development: "In development",
    active: "Active",
    finished: "Finished",
  };
  let bingoSaveTimer = null;
  let bingoBindingsDone = false;
  let bingoPublicPreviewGridBound = false;
  let bingoDimsFilled = false;
  let bingoImageTargetIndex = null;
  let bingoOsrsItemsCache = null;
  let bingoOsrsItemsLoadPromise = null;
  const bingoPluginListeners = new Set();

  function bingoWomBossDisplayName(metric) {
    const M = {
      abyssal_sire: "Abyssal Sire",
      alchemical_hydra: "Alchemical Hydra",
      amoxliatl: "Amoxliatl",
      araxxor: "Araxxor",
      artio: "Artio",
      barrows_chests: "Barrows chests",
      brutus: "Brutus",
      bryophyta: "Bryophyta",
      callisto: "Callisto",
      calvarion: "Calvar'ion",
      cerberus: "Cerberus",
      chambers_of_xeric: "Chambers of Xeric",
      chambers_of_xeric_challenge_mode: "Chambers of Xeric (Challenge Mode)",
      chaos_elemental: "Chaos Elemental",
      chaos_fanatic: "Chaos Fanatic",
      commander_zilyana: "Commander Zilyana",
      corporeal_beast: "Corporeal Beast",
      crazy_archaeologist: "Crazy Archaeologist",
      dagannoth_prime: "Dagannoth Prime",
      dagannoth_rex: "Dagannoth Rex",
      dagannoth_supreme: "Dagannoth Supreme",
      deranged_archaeologist: "Deranged Archaeologist",
      doom_of_mokhaiotl: "Doom of Mokhaiotl",
      duke_sucellus: "Duke Sucellus",
      general_graardor: "General Graardor",
      giant_mole: "Giant Mole",
      grotesque_guardians: "Grotesque Guardians",
      hespori: "Hespori",
      kalphite_queen: "Kalphite Queen",
      king_black_dragon: "King Black Dragon",
      kraken: "Kraken",
      kreearra: "Kree'arra",
      kril_tsutsaroth: "K'ril Tsutsaroth",
      lunar_chests: "Lunar Chests",
      mimic: "Mimic",
      nex: "Nex",
      nightmare: "The Nightmare",
      phosanis_nightmare: "Phosani's Nightmare",
      obor: "Obor",
      phantom_muspah: "Phantom Muspah",
      sarachnis: "Sarachnis",
      scorpia: "Scorpia",
      scurrius: "Scurrius",
      shellbane_gryphon: "Shellbane Gryphon",
      skotizo: "Skotizo",
      sol_heredit: "Sol Heredit",
      spindel: "Spindel",
      tempoross: "Tempoross",
      the_gauntlet: "The Gauntlet",
      the_corrupted_gauntlet: "The Corrupted Gauntlet",
      the_hueycoatl: "The Hueycoatl",
      the_leviathan: "The Leviathan",
      the_royal_titans: "The Royal Titans",
      the_whisperer: "The Whisperer",
      theatre_of_blood: "Theatre of Blood",
      theatre_of_blood_hard_mode: "Theatre of Blood (Hard Mode)",
      thermonuclear_smoke_devil: "Thermonuclear Smoke Devil",
      tombs_of_amascut: "Tombs of Amascut",
      tombs_of_amascut_expert: "Tombs of Amascut (Expert)",
      tzkal_zuk: "TzKal-Zuk",
      tztok_jad: "TzTok-Jad",
      vardorvis: "Vardorvis",
      venenatis: "Venenatis",
      vetion: "Vet'ion",
      vorkath: "Vorkath",
      wintertodt: "Wintertodt",
      yama: "Yama",
      zalcano: "Zalcano",
      zulrah: "Zulrah",
    };
    if (M[metric]) return M[metric];
    return String(metric || "")
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  const BINGO_BOSS_SELECT_LABELS = (() => {
    const seen = new Set();
    const out = [];
    for (const m of WOM_BOSS_METRICS) {
      const label = bingoWomBossDisplayName(m);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  })();

  function startBingoOsrsItemsFetch() {
    if (!bingoOsrsItemsLoadPromise) {
      bingoOsrsItemsLoadPromise = fetch("/data/osrs-bingo-items.json", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : []))
        .then((j) => {
          const raw = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : [];
          bingoOsrsItemsCache = raw.map((x) => String(x || "").trim()).filter(Boolean);
          bingoOsrsItemsCache.sort((a, b) => a.localeCompare(b));
          return bingoOsrsItemsCache;
        })
        .catch(() => {
          bingoOsrsItemsCache = [];
          return bingoOsrsItemsCache;
        });
    }
    return bingoOsrsItemsLoadPromise;
  }

  function bingoOsrsItemsForSelect() {
    return bingoOsrsItemsCache === null ? [] : bingoOsrsItemsCache;
  }

  function bingoBossSelectOptionsHtml(selectedRaw) {
    const cur = String(selectedRaw || "").trim();
    let html = `<option value="">— Boss / source (optional) —</option>`;
    let found = false;
    for (const label of BINGO_BOSS_SELECT_LABELS) {
      if (cur === label) found = true;
      const sel = cur === label ? " selected" : "";
      html += `<option value="${bingoEscapeAttr(label)}"${sel}>${bingoEscapeTextarea(label)}</option>`;
    }
    if (cur && !found) {
      html += `<option value="${bingoEscapeAttr(cur)}" selected>${bingoEscapeTextarea(cur)} (not in list)</option>`;
    }
    return html;
  }

  function bingoParseStoredItemList(raw) {
    const s = String(raw || "").trim();
    if (!s) return [];
    return s
      .split(BINGO_ITEM_LIST_SEP)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function bingoFormatItemsForDisplay(raw) {
    const parts = bingoParseStoredItemList(raw);
    if (parts.length) return parts.join(", ");
    return String(raw || "").trim();
  }

  function bingoItemSelectOptionsHtml(selectedRaw, itemNames) {
    const selected = new Set(bingoParseStoredItemList(selectedRaw));
    const names = Array.isArray(itemNames) ? itemNames : [];
    const nameSet = new Set(names);
    let html = "";
    for (const name of names) {
      const sel = selected.has(name) ? " selected" : "";
      html += `<option value="${bingoEscapeAttr(name)}"${sel}>${bingoEscapeTextarea(name)}</option>`;
    }
    for (const token of selected) {
      if (!nameSet.has(token)) {
        html += `<option value="${bingoEscapeAttr(token)}" selected>${bingoEscapeTextarea(token)} (not in list)</option>`;
      }
    }
    return html;
  }

  function bingoNewBoardId() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch {
      /* ignore */
    }
    return "b-" + Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 11);
  }

  function bingoClampDim(n) {
    const x = parseInt(String(n), 10);
    if (Number.isNaN(x)) return 5;
    return Math.min(BINGO_MAX_DIM, Math.max(BINGO_MIN_DIM, x));
  }

  function bingoSanitizeImageUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (s.startsWith("data:image/")) return s.length <= BINGO_MAX_IMAGE_CHARS ? s : "";
    try {
      const u = new URL(s);
      if (u.protocol === "https:" || u.protocol === "http:") return s.slice(0, 2000);
    } catch {
      /* ignore */
    }
    return "";
  }

  function bingoEscapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function bingoEscapeTextarea(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeBingoBoardStatus(raw) {
    const s = typeof raw === "string" ? String(raw).trim() : "";
    return BINGO_BOARD_STATUSES.includes(s) ? s : "development";
  }

  function bingoPluginSnapshot(state) {
    if (!state || state.v !== 2 || !Array.isArray(state.tiles)) {
      const bs = "development";
      return {
        apiVersion: 1,
        boardStatus: bs,
        boardStatusLabel: BINGO_BOARD_STATUS_LABELS[bs],
        progress: { done: 0, total: 0, percent: 0 },
      };
    }
    const rows = bingoClampDim(state.rows);
    const cols = bingoClampDim(state.cols);
    const total = rows * cols;
    const tiles = state.tiles;
    let done = 0;
    for (let i = 0; i < total; i++) {
      if (tiles[i] && tiles[i].done) done++;
    }
    const bs = normalizeBingoBoardStatus(state.boardStatus);
    return {
      apiVersion: 1,
      ...state,
      boardStatus: bs,
      boardStatusLabel: BINGO_BOARD_STATUS_LABELS[bs],
      progress: { done, total, percent: total ? Math.round((done / total) * 1000) / 10 : 0 },
    };
  }

  function bingoNotifyPluginListeners(rawState) {
    if (!bingoPluginListeners.size) return;
    const snap = bingoPluginSnapshot(rawState);
    bingoPluginListeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        /* external plugin callback */
      }
    });
  }

  function normalizeBingoTile(t, r, c) {
    const tint = BINGO_TINTS.includes(t && t.tint) ? t.tint : "neutral";
    const id = t && typeof t.id === "string" && /^r\d+c\d+$/.test(t.id) ? t.id : `r${r}c${c}`;
    return {
      id,
      text: typeof t.text === "string" ? t.text.slice(0, 800) : "",
      item: typeof t.item === "string" ? t.item.slice(0, BINGO_ITEM_FIELD_MAX) : "",
      boss: typeof t.boss === "string" ? t.boss.slice(0, 200) : "",
      notes: typeof t.notes === "string" ? t.notes.slice(0, 1200) : "",
      tint,
      done: !!t.done,
      imageUrl: bingoSanitizeImageUrl(t && t.imageUrl),
      imageAlt: t && typeof t.imageAlt === "string" ? t.imageAlt.slice(0, 200) : "",
    };
  }

  /** Per-tile, per-team booleans: team k got this tile's listed items (board preview toggles). */
  function bingoNormalizeTeamTileDone(o, tiles, teamCount) {
    const n = Math.min(BINGO_TEAM_COUNT_MAX, Math.max(0, Math.floor(teamCount) || 0));
    const raw = o && typeof o.teamTileDone === "object" && o.teamTileDone !== null ? o.teamTileDone : {};
    const out = {};
    for (let ti = 0; ti < (tiles || []).length; ti++) {
      const t = tiles[ti];
      const id = t && typeof t.id === "string" ? t.id : `r0c${ti}`;
      const prev = raw[id];
      let a = Array.isArray(prev) ? prev.map((x) => !!x) : [];
      while (a.length < n) a.push(false);
      if (a.length > n) a = a.slice(0, n);
      out[id] = a;
    }
    return out;
  }

  function normalizeBingoTeams(o) {
    const parsed = parseInt(String(o && o.teamCount != null ? o.teamCount : "0"), 10);
    let n = Number.isFinite(parsed) ? parsed : 0;
    n = Math.min(BINGO_TEAM_COUNT_MAX, Math.max(0, n));

    const padSlice = (arr, maxFieldLen, nSlots, trimNames) => {
      let a = Array.isArray(arr) ? arr.map((x) => String(x ?? "")) : [];
      a = a.map((s) => {
        const t = trimNames ? s.trim() : s;
        return t.slice(0, maxFieldLen);
      });
      while (a.length < nSlots) a.push("");
      if (a.length > nSlots) a = a.slice(0, nSlots);
      return a;
    };

    const names = padSlice(o && o.teamNames, BINGO_TEAM_NAME_MAX, n, true);
    const captains = padSlice(o && o.teamCaptains, BINGO_TEAM_CAPTAIN_MAX, n, true);
    const members = padSlice(o && o.teamMembers, BINGO_TEAM_MEMBERS_MAX, n, false);

    const tintsIn = Array.isArray(o && o.teamTints) ? o.teamTints : [];
    const tints = [];
    for (let i = 0; i < n; i++) {
      const tv = tintsIn[i];
      tints.push(BINGO_TINTS.includes(tv) ? tv : "neutral");
    }

    return { teamCount: n, teamNames: names, teamTints: tints, teamCaptains: captains, teamMembers: members };
  }

  function defaultBingoState() {
    const rows = 5;
    const cols = 5;
    const cr = Math.floor(rows / 2);
    const cc = Math.floor(cols / 2);
    const centerFree = rows % 2 === 1 && cols % 2 === 1;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push(
          normalizeBingoTile(
            {
              text: centerFree && r === cr && c === cc ? "FREE SPACE" : "",
              item: "",
              boss: "",
              notes: "",
              tint: "neutral",
              done: false,
              imageUrl: "",
              imageAlt: "",
            },
            r,
            c
          )
        );
      }
    }
    const teams = normalizeBingoTeams({});
    return {
      v: 2,
      boardId: bingoNewBoardId(),
      title: "",
      boardStatus: "development",
      rows,
      cols,
      tiles,
      ...teams,
      teamTileDone: bingoNormalizeTeamTileDone({}, tiles, teams.teamCount),
    };
  }

  function migrateBingoV1ToV2(o) {
    const tiles = [];
    for (let i = 0; i < 25; i++) {
      const r = Math.floor(i / 5);
      const c = i % 5;
      const t = o.tiles[i] || {};
      tiles.push(
        normalizeBingoTile(
          {
            text: t.text,
            item: t.item,
            boss: t.boss,
            notes: "",
            tint: t.tint,
            done: t.done,
            imageUrl: "",
            imageAlt: "",
          },
          r,
          c
        )
      );
    }
    const teams = normalizeBingoTeams({});
    return {
      v: 2,
      boardId: bingoNewBoardId(),
      title: typeof o.title === "string" ? o.title.slice(0, 120) : "",
      boardStatus: "development",
      rows: 5,
      cols: 5,
      tiles,
      ...teams,
      teamTileDone: bingoNormalizeTeamTileDone({}, tiles, teams.teamCount),
    };
  }

  function readBingoState() {
    try {
      let raw = localStorage.getItem(BINGO_STORAGE_KEY);
      if (!raw) raw = localStorage.getItem(BINGO_LEGACY_KEY);
      if (!raw) return defaultBingoState();
      const o = JSON.parse(raw);
      if (o.v === 1 && Array.isArray(o.tiles) && o.tiles.length === 25) {
        const m = migrateBingoV1ToV2(o);
        writeBingoState(m);
        try {
          localStorage.removeItem(BINGO_LEGACY_KEY);
        } catch {
          /* ignore */
        }
        return m;
      }
      if (o.v !== 2 || !Array.isArray(o.tiles)) return defaultBingoState();
      const rows = bingoClampDim(o.rows);
      const cols = bingoClampDim(o.cols);
      if (o.tiles.length !== rows * cols) return defaultBingoState();
      let idx = 0;
      const tiles = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          tiles.push(normalizeBingoTile(o.tiles[idx] || {}, r, c));
          idx++;
        }
      }
      const boardId =
        typeof o.boardId === "string" && o.boardId.length >= 6 ? o.boardId : bingoNewBoardId();
      const teams = normalizeBingoTeams(o);
      return {
        v: 2,
        boardId,
        title: typeof o.title === "string" ? o.title.slice(0, 120) : "",
        boardStatus: normalizeBingoBoardStatus(o.boardStatus),
        rows,
        cols,
        tiles,
        ...teams,
        teamTileDone: bingoNormalizeTeamTileDone(o, tiles, teams.teamCount),
      };
    } catch {
      return defaultBingoState();
    }
  }

  function writeBingoState(state) {
    try {
      const payload = { ...state, boardStatus: normalizeBingoBoardStatus(state.boardStatus) };
      localStorage.setItem(BINGO_STORAGE_KEY, JSON.stringify(payload));
      bingoNotifyPluginListeners(payload);
    } catch {
      /* quota */
    }
  }

  function bingoReadAdvancedOpen() {
    try {
      return localStorage.getItem(BINGO_ADVANCED_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function bingoWriteAdvancedOpen(on) {
    try {
      localStorage.setItem(BINGO_ADVANCED_OPEN_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function bingoApplyAdvancedToggleUi() {
    const grid = document.getElementById("bingo-grid");
    const btn = document.getElementById("bingo-toggle-advanced");
    const on = bingoReadAdvancedOpen();
    if (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "Hide advanced fields" : "Show advanced fields";
    }
    if (!grid) return;
    grid.querySelectorAll(".bingo-tile-advanced").forEach((d) => {
      d.open = on;
    });
  }

  function resizeBingoState(state, newRows, newCols) {
    const oldRows = state.rows;
    const oldCols = state.cols;
    const oldTiles = state.tiles.slice();
    const tiles = [];
    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        if (r < oldRows && c < oldCols) {
          const oi = r * oldCols + c;
          const t = normalizeBingoTile({ ...oldTiles[oi] }, r, c);
          t.id = `r${r}c${c}`;
          tiles.push(t);
        } else {
          tiles.push(
            normalizeBingoTile(
              {
                text: "",
                item: "",
                boss: "",
                notes: "",
                tint: "neutral",
                done: false,
                imageUrl: "",
                imageAlt: "",
              },
              r,
              c
            )
          );
        }
      }
    }
    const teams = normalizeBingoTeams(state);
    const next = {
      v: 2,
      boardId: state.boardId,
      title: state.title,
      boardStatus: normalizeBingoBoardStatus(state.boardStatus),
      rows: newRows,
      cols: newCols,
      tiles,
      ...teams,
      teamTileDone: bingoNormalizeTeamTileDone({ teamTileDone: state.teamTileDone }, tiles, teams.teamCount),
    };
    return next;
  }

  function bingoUpdateProgress() {
    const el = document.getElementById("bingo-progress");
    const grid = document.getElementById("bingo-grid");
    if (!el || !grid) return;
    const total = parseInt(grid.dataset.bingoRows || "5", 10) * parseInt(grid.dataset.bingoCols || "5", 10);
    let n = 0;
    grid.querySelectorAll('.bingo-tile-toggle[aria-pressed="true"]').forEach(() => {
      n++;
    });
    el.textContent = `${n} / ${total} complete`;
  }

  function collectBingoFromDom() {
    const titleEl = document.getElementById("bingo-board-title");
    const title = titleEl ? String(titleEl.value || "").slice(0, 120) : "";
    const grid = document.getElementById("bingo-grid");
    if (!grid) return defaultBingoState();
    const rows = bingoClampDim(grid.dataset.bingoRows);
    const cols = bingoClampDim(grid.dataset.bingoCols);
    const boardId = String(grid.dataset.boardId || "").trim() || bingoNewBoardId();
    const tiles = [];
    const teamTileDoneRaw = {};
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = grid.querySelector(`.bingo-tile[data-bingo-index="${i}"]`);
        if (!tile) {
          tiles.push(
            normalizeBingoTile(
              { text: "", item: "", boss: "", notes: "", tint: "neutral", done: false, imageUrl: "", imageAlt: "" },
              r,
              c
            )
          );
          i++;
          continue;
        }
        const tintSel = tile.querySelector(".bingo-tile-tint");
        const tint = BINGO_TINTS.includes(tintSel && tintSel.value) ? tintSel.value : "neutral";
        const task = tile.querySelector(".bingo-tile-task");
        const item = tile.querySelector(".bingo-tile-item");
        const boss = tile.querySelector(".bingo-tile-boss");
        let itemVal = "";
        if (item && item.multiple) {
          itemVal = Array.from(item.selectedOptions)
            .map((o) => String(o.value || "").trim())
            .filter(Boolean)
            .join(BINGO_ITEM_LIST_SEP);
        } else if (item) {
          itemVal = String(item.value || "").trim();
        }
        const notes = tile.querySelector(".bingo-tile-notes");
        const imgUrlInp = tile.querySelector(".bingo-tile-image-url");
        const imgAltInp = tile.querySelector(".bingo-tile-image-alt");
        const togg = tile.querySelector(".bingo-tile-toggle");
        const normTile = normalizeBingoTile(
          {
            text: (task && task.value) || "",
            item: itemVal,
            boss: (boss && boss.value) || "",
            notes: (notes && notes.value) || "",
            tint,
            done: togg && togg.getAttribute("aria-pressed") === "true",
            imageUrl: (imgUrlInp && imgUrlInp.value) || "",
            imageAlt: (imgAltInp && imgAltInp.value) || "",
          },
          r,
          c
        );
        tiles.push(normTile);
        const teamBtns = tile.querySelectorAll(".bingo-tile-team-got");
        if (teamBtns.length) {
          const arr = [];
          teamBtns.forEach((btn) => {
            arr.push(btn.getAttribute("aria-pressed") === "true");
          });
          teamTileDoneRaw[normTile.id] = arr;
        }
        i++;
      }
    }
    const teams = collectBingoTeamsFromDom();
    const prev = readBingoState();
    const statusSel = document.getElementById("bingo-board-status");
    const boardStatus = normalizeBingoBoardStatus(
      statusSel && statusSel.value != null && statusSel.value !== "" ? statusSel.value : prev.boardStatus
    );
    return {
      v: 2,
      boardId,
      title,
      boardStatus,
      rows,
      cols,
      tiles,
      ...teams,
      teamTileDone: bingoNormalizeTeamTileDone(
        { teamTileDone: { ...(prev.teamTileDone || {}), ...teamTileDoneRaw } },
        tiles,
        teams.teamCount
      ),
    };
  }

  function scrapeBingoTeamColumnsFromDom() {
    const root = document.getElementById("bingo-team-names");
    if (!root) return null;
    const cols = [...root.querySelectorAll(".bingo-team-column")].sort(
      (a, b) =>
        parseInt(a.getAttribute("data-bingo-team-col") || "0", 10) -
        parseInt(b.getAttribute("data-bingo-team-col") || "0", 10)
    );
    if (!cols.length) return null;
    const teamNames = [];
    const teamCaptains = [];
    const teamMembers = [];
    cols.forEach((col) => {
      teamNames.push(String(col.querySelector("[data-bingo-team-idx]")?.value || "").trim());
      teamCaptains.push(String(col.querySelector("[data-bingo-team-captain]")?.value || "").trim());
      teamMembers.push(String(col.querySelector("[data-bingo-team-members]")?.value || ""));
    });
    return { teamNames, teamCaptains, teamMembers };
  }

  function collectBingoTeamsFromDom() {
    const sel = document.getElementById("bingo-team-count");
    let n = parseInt(String(sel && sel.value != null ? sel.value : "0"), 10);
    if (!Number.isFinite(n)) n = 0;
    n = Math.min(BINGO_TEAM_COUNT_MAX, Math.max(0, n));
    const scraped = scrapeBingoTeamColumnsFromDom();
    if (scraped) {
      return normalizeBingoTeams({ teamCount: n, ...scraped });
    }
    return normalizeBingoTeams({ teamCount: n });
  }

  function renderBingoTeamColumns(t) {
    const root = document.getElementById("bingo-team-names");
    if (!root) return;
    const n = t.teamCount;
    if (n === 0) {
      root.innerHTML =
        '<p class="muted bingo-teams-placeholder">Pick how many teams above — each team opens as its own column.</p>';
      return;
    }
    let html = `<div class="bingo-teams-columns-wrap"><div class="bingo-teams-columns" style="grid-template-columns: repeat(${n}, minmax(12rem, 1fr))" role="group" aria-label="Team columns">`;
    for (let i = 0; i < n; i++) {
      const name = t.teamNames[i] != null ? String(t.teamNames[i]) : "";
      const captain = t.teamCaptains[i] != null ? String(t.teamCaptains[i]) : "";
      const memberText = t.teamMembers[i] != null ? String(t.teamMembers[i]) : "";
      const nameEsc = bingoEscapeAttr(name);
      const captainEsc = bingoEscapeAttr(captain);
      const membersEsc = bingoEscapeTextarea(memberText);
      html += `<div class="bingo-tile bingo-team-column bingo-tile--neutral" data-bingo-team-col="${i}">
        <div class="bingo-tile-head">
          <span class="bingo-tile-id">Team ${i + 1}</span>
        </div>
        <label class="sr-only" for="bingo-team-name-${i}">Team name</label>
        <input type="text" id="bingo-team-name-${i}" class="bingo-team-name-input event-add-input" data-bingo-team-idx="${i}" maxlength="${BINGO_TEAM_NAME_MAX}" placeholder="Team name" value="${nameEsc}" autocomplete="off" />
        <div class="bingo-team-section">
          <label class="bingo-team-section-label" for="bingo-team-captain-${i}">Team captain</label>
          <input type="text" id="bingo-team-captain-${i}" class="bingo-team-captain-input event-add-input" data-bingo-team-captain="${i}" maxlength="${BINGO_TEAM_CAPTAIN_MAX}" placeholder="Captain name" value="${captainEsc}" autocomplete="name" />
        </div>
        <div class="bingo-team-section">
          <label class="bingo-team-section-label" for="bingo-team-members-${i}">Members</label>
          <textarea id="bingo-team-members-${i}" class="bingo-team-members-textarea" data-bingo-team-members="${i}" maxlength="${BINGO_TEAM_MEMBERS_MAX}" rows="4" placeholder="One name per line">${membersEsc}</textarea>
        </div>
      </div>`;
    }
    html += "</div></div>";
    root.innerHTML = html;
  }

  function renderBingoTeamsUi(state) {
    const t = normalizeBingoTeams(state);
    const sel = document.getElementById("bingo-team-count");
    if (sel) sel.value = String(t.teamCount);
    renderBingoTeamColumns(t);
    bingoRenderTeamsSignups(state);
  }

  function scheduleBingoSave() {
    const main = document.getElementById("bingo-access-main");
    if (main && main.hidden) return;
    if (bingoSaveTimer) clearTimeout(bingoSaveTimer);
    bingoSaveTimer = setTimeout(() => {
      bingoSaveTimer = null;
      writeBingoState(collectBingoFromDom());
      bingoUpdateProgress();
    }, 400);
  }

  function bingoRefreshTilePreview(tile, url) {
    const safe = bingoSanitizeImageUrl(url);
    const wrap = tile.querySelector(".bingo-tile-thumb-wrap");
    if (!wrap) return;
    if (!safe) {
      wrap.innerHTML =
        '<div class="bingo-tile-thumb bingo-tile-thumb--empty muted" aria-hidden="true">No image</div>';
      return;
    }
    const altEl = tile.querySelector(".bingo-tile-image-alt");
    const alt = altEl ? String(altEl.value || "").slice(0, 200) : "";
    wrap.innerHTML = `<img class="bingo-tile-thumb" src="${bingoEscapeAttr(safe)}" alt="${bingoEscapeAttr(alt)}" loading="lazy" />`;
  }

  function bingoShrinkDataUrl(dataUrl, maxLen, done) {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        done(null);
        return;
      }
      const scales = [1, 0.72, 0.5, 0.36, 0.25, 0.18];
      for (let si = 0; si < scales.length; si++) {
        const sc = scales[si];
        canvas.width = Math.max(32, Math.round(w * sc));
        canvas.height = Math.max(32, Math.round(h * sc));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = canvas.toDataURL("image/jpeg", 0.82);
        if (out.length <= maxLen) {
          done(out);
          return;
        }
      }
      done(null);
    };
    img.onerror = () => done(null);
    img.src = dataUrl;
  }

  function bingoSyncItemMultiVisuals(tile) {
    if (!tile) return;
    const sel = tile.querySelector("select.bingo-tile-item--multi");
    const out = tile.querySelector(".bingo-tile-item-picked");
    if (!sel || !out) return;
    const names = Array.from(sel.selectedOptions || [])
      .map((o) => String(o.textContent || o.value || "").replace(/\s*\(not in list\)\s*$/i, "").trim())
      .filter(Boolean);
    if (!names.length) {
      out.textContent = "";
      out.hidden = true;
      sel.classList.remove("bingo-tile-item--has-picks");
      return;
    }
    out.hidden = false;
    out.textContent = `Selected: ${names.join(", ")}`;
    sel.classList.add("bingo-tile-item--has-picks");
  }

  function bingoRefreshAllItemMultiVisuals(grid) {
    if (!grid) return;
    grid.querySelectorAll(".bingo-tile").forEach((tile) => bingoSyncItemMultiVisuals(tile));
  }

  function bingoSyncTeamToggleAvailability(tile) {
    if (!tile) return;
    const sel = tile.querySelector("select.bingo-tile-item--multi");
    const hasItems = !!(sel && Array.from(sel.selectedOptions || []).some((o) => String(o.value || "").trim()));
    tile.querySelectorAll(".bingo-tile-team-got").forEach((btn) => {
      btn.disabled = !hasItems;
      btn.setAttribute("aria-disabled", hasItems ? "false" : "true");
      if (!hasItems) btn.title = "Pick at least one item for this tile first";
    });
  }

  function bingoRefreshAllTeamToggleAvailability(grid) {
    if (!grid) return;
    grid.querySelectorAll(".bingo-tile").forEach((tile) => bingoSyncTeamToggleAvailability(tile));
  }

  function renderBingoGridFromState(state) {
    const grid = document.getElementById("bingo-grid");
    const titleEl = document.getElementById("bingo-board-title");
    const idEl = document.getElementById("bingo-board-id");
    if (!grid) return;
    if (titleEl) titleEl.value = state.title || "";
    if (idEl) idEl.textContent = state.boardId || "—";
    const statusSel = document.getElementById("bingo-board-status");
    if (statusSel) statusSel.value = normalizeBingoBoardStatus(state.boardStatus);
    grid.dataset.bingoRows = String(state.rows);
    grid.dataset.bingoCols = String(state.cols);
    grid.dataset.boardId = state.boardId || "";

    const rowsSel = document.getElementById("bingo-rows");
    const colsSel = document.getElementById("bingo-cols");
    if (rowsSel) rowsSel.value = String(state.rows);
    if (colsSel) colsSel.value = String(state.cols);

    const teamsMeta = normalizeBingoTeams(state);
    const teamTileDoneMap = bingoNormalizeTeamTileDone(state, state.tiles || [], teamsMeta.teamCount);
    const total = state.rows * state.cols;
    grid.classList.toggle("bingo-grid--many", total > 36);
    grid.style.gridTemplateColumns = `repeat(${state.cols}, minmax(0, 1fr))`;

    let html = "";
    let i = 0;
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const t = state.tiles[i] || normalizeBingoTile({}, r, c);
        const tint = BINGO_TINTS.includes(t.tint) ? t.tint : "neutral";
        const done = !!t.done;
        const safeImg = bingoSanitizeImageUrl(t.imageUrl);
        const thumbInner = safeImg
          ? `<img class="bingo-tile-thumb" src="${bingoEscapeAttr(safeImg)}" alt="${bingoEscapeAttr(t.imageAlt)}" loading="lazy" />`
          : '<div class="bingo-tile-thumb bingo-tile-thumb--empty muted" aria-hidden="true">No image</div>';
        const taskEsc = bingoEscapeTextarea(t.text);
        const itemOpts = bingoItemSelectOptionsHtml(t.item, bingoOsrsItemsForSelect());
        const bossOpts = bingoBossSelectOptionsHtml(t.boss);
        const notesEsc = bingoEscapeTextarea(t.notes);
        const imgUrlEsc = bingoEscapeAttr(t.imageUrl);
        const imgAltEsc = bingoEscapeAttr(t.imageAlt);
        const itemListSize = total > 36 ? 3 : 5;
        const advancedOpen = bingoReadAdvancedOpen();
        let teamPickerBlock = "";
        const hasItemsForTeams = String(t.item || "").trim().length > 0;
        if (teamsMeta.teamCount > 0) {
          const arr = teamTileDoneMap[t.id] || [];
          let teamBtns = "";
          for (let ti = 0; ti < teamsMeta.teamCount; ti++) {
            const got = !!arr[ti];
            const title = hasItemsForTeams
              ? `Team ${ti + 1} has this tile's items`
              : "Pick at least one item for this tile first";
            teamBtns += `<button type="button" class="bingo-tile-team-got${got ? " bingo-tile-team-got--on" : ""}" data-bingo-team-tile="${bingoEscapeAttr(t.id)}" data-bingo-team-idx="${ti}" aria-pressed="${got ? "true" : "false"}" aria-label="Toggle Team ${ti + 1} item ownership for ${bingoEscapeAttr(t.id)}" ${hasItemsForTeams ? "" : 'disabled aria-disabled="true"'} title="${bingoEscapeAttr(title)}">T${ti + 1}</button>`;
          }
          teamPickerBlock = `<div class="bingo-tile-team-items" role="group" aria-label="Teams with items for ${bingoEscapeAttr(t.id)}">
            <span class="bingo-tile-team-items-label">Teams with items</span>
            <div class="bingo-tile-team-got-row">${teamBtns}</div>
          </div>`;
        }
        html += `<div class="bingo-tile bingo-tile--${tint}${done ? " bingo-tile--done" : ""}" data-bingo-index="${i}">
          <div class="bingo-tile-head">
            <span class="bingo-tile-id">${bingoEscapeAttr(t.id)}</span>
            <button type="button" class="bingo-tile-toggle" aria-pressed="${done}" title="Mark tile complete">${done ? "✓" : "○"}</button>
          </div>
          <div class="bingo-tile-thumb-wrap">${thumbInner}</div>
          <div class="bingo-tile-img-actions">
            <button type="button" class="bingo-tile-upload-btn" data-bingo-upload="${i}">Upload</button>
            <button type="button" class="bingo-tile-clear-img" data-bingo-clear-img="${i}">Clear image</button>
          </div>
          <label class="sr-only" for="bingo-tint-${i}">Tile type</label>
          <select id="bingo-tint-${i}" class="bingo-tile-tint" aria-label="Tile type ${t.id}">
            <option value="neutral"${tint === "neutral" ? " selected" : ""}>General</option>
            <option value="easy"${tint === "easy" ? " selected" : ""}>Easy / solo</option>
            <option value="mass"${tint === "mass" ? " selected" : ""}>Team mass</option>
            <option value="hard"${tint === "hard" ? " selected" : ""}>Hard / specific</option>
          </select>
          <label class="sr-only" for="bingo-task-${i}">Task</label>
          <textarea id="bingo-task-${i}" class="bingo-tile-task" maxlength="800" rows="2" placeholder="Task, drop, or goal…">${taskEsc}</textarea>
          <label class="sr-only" for="bingo-item-${i}">Items</label>
          <select id="bingo-item-${i}" class="bingo-tile-item bingo-tile-item--multi" multiple size="${itemListSize}" aria-label="Items for tile ${bingoEscapeAttr(t.id)}. Hold Ctrl or Command while clicking to select several." title="Ctrl or ⌘ + click to select multiple items">${itemOpts}</select>
          <p class="muted bingo-tile-item-hint">Ctrl / ⌘ + click to select multiple items.</p>
          <p class="bingo-tile-item-picked muted" hidden></p>
          ${teamPickerBlock}
          <details class="bingo-tile-advanced"${advancedOpen ? " open" : ""}>
            <summary class="bingo-tile-advanced-summary">More options</summary>
            <div class="bingo-tile-advanced-body">
              <label class="sr-only" for="bingo-boss-${i}">Boss or source</label>
              <select id="bingo-boss-${i}" class="bingo-tile-boss" aria-label="Boss or source for ${bingoEscapeAttr(t.id)}">${bossOpts}</select>
              <label class="sr-only" for="bingo-notes-${i}">Notes</label>
              <textarea id="bingo-notes-${i}" class="bingo-tile-notes" maxlength="1200" rows="2" placeholder="Extra notes (optional)…">${notesEsc}</textarea>
              <label class="sr-only" for="bingo-imgurl-${i}">Image URL</label>
              <input id="bingo-imgurl-${i}" class="bingo-tile-image-url" maxlength="2000" placeholder="Image URL (https:// or paste data URL)" value="${imgUrlEsc}" />
              <label class="sr-only" for="bingo-imgalt-${i}">Image description</label>
              <input id="bingo-imgalt-${i}" class="bingo-tile-image-alt" maxlength="200" placeholder="Image description (optional)" value="${imgAltEsc}" />
            </div>
          </details>
        </div>`;
        i++;
      }
    }
    grid.innerHTML = html;
    bingoApplyAdvancedToggleUi();
    bingoRefreshAllItemMultiVisuals(grid);
    bingoRefreshAllTeamToggleAvailability(grid);
    bingoUpdateProgress();
    renderBingoTeamsUi(state);
  }

  function bingoPublicTileHasDisplayContent(t) {
    if (!t) return false;
    if (String(t.text || "").trim()) return true;
    if (String(t.item || "").trim()) return true;
    if (String(t.boss || "").trim()) return true;
    if (String(t.notes || "").trim()) return true;
    if (bingoSanitizeImageUrl(t.imageUrl)) return true;
    return false;
  }

  function bingoReadSignupsStore() {
    try {
      const raw = localStorage.getItem(BINGO_SIGNUPS_STORAGE_KEY);
      if (!raw) return { byBoard: {} };
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || o.byBoard == null || typeof o.byBoard !== "object") return { byBoard: {} };
      return { byBoard: o.byBoard };
    } catch {
      return { byBoard: {} };
    }
  }

  function bingoWriteSignupsStore(store) {
    try {
      localStorage.setItem(BINGO_SIGNUPS_STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* quota */
    }
  }

  function bingoGetSignupsForBoard(boardId) {
    const bid = String(boardId || "");
    const st = bingoReadSignupsStore();
    const arr = st.byBoard[bid];
    return Array.isArray(arr) ? arr : [];
  }

  function bingoSetSignupsForBoard(boardId, entries) {
    const st = bingoReadSignupsStore();
    st.byBoard[String(boardId || "")] = entries;
    bingoWriteSignupsStore(st);
  }

  function bingoSignupNewId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function bingoSignupNormalizeName(raw) {
    return String(raw || "")
      .trim()
      .slice(0, BINGO_SIGNUP_NAME_MAX);
  }

  function bingoTeamMembersAddLine(teamMembersArr, teamIndex, line) {
    const t = teamMembersArr.slice();
    const cur = String(t[teamIndex] || "");
    const lines = cur.split(/\r?\n/);
    const key = line.trim().toLowerCase();
    if (!key) return t;
    if (lines.some((ln) => ln.trim().toLowerCase() === key)) return t;
    const next = cur ? cur.replace(/\s*$/, "") + "\n" + line.trim() : line.trim();
    t[teamIndex] = next.slice(0, BINGO_TEAM_MEMBERS_MAX);
    return t;
  }

  function bingoTeamMembersRemoveLine(teamMembersArr, teamIndex, line) {
    const t = teamMembersArr.slice();
    const key = line.trim().toLowerCase();
    if (!key) return t;
    const lines = String(t[teamIndex] || "").split(/\r?\n/);
    t[teamIndex] = lines.filter((ln) => ln.trim().toLowerCase() !== key).join("\n").slice(0, BINGO_TEAM_MEMBERS_MAX);
    return t;
  }

  /** Migrate legacy `onTeam` to `rosterTeamIdx`; returns true if the entry object was changed. */
  function bingoMigrateSignupEntry(e) {
    if (!e || typeof e !== "object") return false;
    let dirty = false;
    if (e.rosterTeamIdx === undefined) {
      if (e.onTeam === true) e.rosterTeamIdx = 0;
      else e.rosterTeamIdx = null;
      dirty = true;
    } else if (typeof e.rosterTeamIdx === "number" && !Number.isFinite(e.rosterTeamIdx)) {
      e.rosterTeamIdx = null;
      dirty = true;
    }
    if (e.onTeam !== undefined) {
      delete e.onTeam;
      dirty = true;
    }
    return dirty;
  }

  function bingoClampSignupRosterIdx(e, teamCount) {
    const n = Math.max(0, Math.floor(teamCount) || 0);
    if (e.rosterTeamIdx != null && (e.rosterTeamIdx < 0 || e.rosterTeamIdx >= n)) {
      e.rosterTeamIdx = null;
      return true;
    }
    return false;
  }

  /** Remove player from `from` roster slot and add to `to` (null = not on any team roster). */
  function bingoSetPlayerOnTeamRoster(state, playerName, fromIdx, toIdx) {
    const nt = normalizeBingoTeams(state);
    const n = nt.teamCount;
    const clamp = (i) =>
      i != null && Number.isFinite(i) && Math.floor(i) === i && i >= 0 && i < n ? i : null;
    const from = clamp(fromIdx);
    const to = clamp(toIdx);
    if (from === to) return { ...state, ...nt };
    let teamMembers = nt.teamMembers.slice();
    if (from != null) teamMembers = bingoTeamMembersRemoveLine(teamMembers, from, playerName);
    if (to != null) teamMembers = bingoTeamMembersAddLine(teamMembers, to, playerName);
    return { ...state, ...normalizeBingoTeams({ ...nt, teamMembers }) };
  }

  function bingoAddSignupEntry(boardId, rawName) {
    const name = bingoSignupNormalizeName(rawName);
    if (!name) return "Enter a name.";
    const bid = String(boardId || "");
    let entries = bingoGetSignupsForBoard(bid);
    if (entries.some((e) => String(e.name || "").trim().toLowerCase() === name.toLowerCase())) {
      return "That name is already on the sign-up list.";
    }
    entries = entries.concat([{ id: bingoSignupNewId(), name, rosterTeamIdx: null }]);
    bingoSetSignupsForBoard(bid, entries);
    return null;
  }

  /** After team count changes, drop roster assignments that no longer fit; persist sign-up store. */
  function bingoClampSignupsToTeamCount(boardId, teamCount) {
    const entries = bingoGetSignupsForBoard(boardId);
    if (!entries.length) return;
    let touched = false;
    for (const e of entries) {
      if (bingoMigrateSignupEntry(e)) touched = true;
      if (bingoClampSignupRosterIdx(e, teamCount)) touched = true;
    }
    if (touched) bingoSetSignupsForBoard(boardId, entries);
  }

  /** Remove every sign-up for this board and strip those names from team rosters they were assigned to. */
  function bingoClearAllSignupsForBoard(boardId) {
    const bid = String(boardId || "");
    const entries = bingoGetSignupsForBoard(bid);
    if (!entries.length) return;
    let st = readBingoState();
    for (const e of entries) {
      bingoMigrateSignupEntry(e);
      const idx = e.rosterTeamIdx;
      if (idx == null || !Number.isFinite(idx) || idx < 0) continue;
      const nt = normalizeBingoTeams(st);
      if (idx >= nt.teamCount) continue;
      st = bingoSetPlayerOnTeamRoster(st, e.name, idx, null);
    }
    bingoSetSignupsForBoard(bid, []);
    writeBingoState(st);
  }

  function bingoRenderTeamsSignups(state) {
    const wrap = document.getElementById("bingo-teams-signups");
    const list = document.getElementById("bingo-teams-signups-list");
    const resetBtn = document.getElementById("bingo-teams-signups-reset");
    if (!wrap || !list) return;
    const boardId = String(state.boardId || "");
    const entries = bingoGetSignupsForBoard(boardId);
    const teamsMeta = normalizeBingoTeams(state);
    const n = teamsMeta.teamCount;
    let storeDirty = false;
    entries.forEach((e) => {
      if (bingoMigrateSignupEntry(e)) storeDirty = true;
      if (bingoClampSignupRosterIdx(e, n)) storeDirty = true;
    });
    if (storeDirty) bingoSetSignupsForBoard(boardId, entries);
    if (resetBtn) resetBtn.disabled = entries.length === 0;
    if (!entries.length) {
      list.innerHTML =
        '<li class="bingo-teams-signups-empty muted">No sign-ups yet. Use <strong>Sign up</strong> on the board preview (before unlock) to add a name.</li>';
      return;
    }
    list.innerHTML = entries
      .map((e) => {
        const safeName = bingoEscapeTextarea(e.name);
        const idEsc = bingoEscapeAttr(e.id);
        const ri = e.rosterTeamIdx;
        const selVal = ri != null && ri >= 0 && ri < n ? String(ri) : "";
        const disabled = n < 1 ? " disabled" : "";
        const title = n >= 1 ? "" : ' title="Set number of teams above first."';
        let optHtml = '<option value="">Not on a roster</option>';
        for (let i = 0; i < n; i++) {
          const sel = String(i) === selVal ? " selected" : "";
          optHtml += `<option value="${i}"${sel}>Team ${i + 1}</option>`;
        }
        return `<li class="bingo-teams-signup-row">
        <div class="bingo-teams-signup-row-inner"${title}>
          <span class="bingo-teams-signup-name">${safeName}</span>
          <select class="bingo-teams-signup-team-select bingo-dim-select" data-bingo-signup-id="${idEsc}" aria-label="${bingoEscapeAttr(e.name)} — assign to team"${disabled}>${optHtml}</select>
        </div>
      </li>`;
      })
      .join("");
  }

  function bindBingoSignupHandlers() {
    const openBtn = document.getElementById("bingo-signup-open-btn");
    const dlg = document.getElementById("bingo-signup-dialog");
    const form = document.getElementById("bingo-signup-form");
    const cancel = document.getElementById("bingo-signup-cancel");
    const inp = document.getElementById("bingo-signup-name-input");
    const signupsRoot = document.getElementById("bingo-teams-signups");
    const resetSignupsBtn = document.getElementById("bingo-teams-signups-reset");

    resetSignupsBtn?.addEventListener("click", () => {
      const st = readBingoState();
      const bid = String(st.boardId || "");
      const n = bingoGetSignupsForBoard(bid).length;
      if (!n) return;
      if (
        !window.confirm(
          "Clear all bingo sign-ups for this board? Anyone assigned to a team via sign-up will be removed from those team member lists."
        )
      )
        return;
      bingoClearAllSignupsForBoard(bid);
      const main = document.getElementById("bingo-access-main");
      if (main && !main.hidden) renderBingoTeamsUi(readBingoState());
      else bingoRenderTeamsSignups(readBingoState());
      renderBingoPublicPreview(readBingoState());
    });

    openBtn?.addEventListener("click", () => {
      if (inp) inp.value = "";
      if (dlg && typeof dlg.showModal === "function") {
        dlg.showModal();
        queueMicrotask(() => inp?.focus());
      } else {
        const st = readBingoState();
        const name = window.prompt("Enter your OSRS display name:", "");
        if (name == null) return;
        const err = bingoAddSignupEntry(st.boardId, name);
        if (err) {
          window.alert(err);
          return;
        }
        renderBingoPublicPreview(readBingoState());
        bingoRenderTeamsSignups(readBingoState());
      }
    });

    cancel?.addEventListener("click", () => dlg?.close());

    dlg?.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const st = readBingoState();
      const name = inp ? String(inp.value || "").trim() : "";
      if (!name) {
        window.alert("Please enter your OSRS name.");
        return;
      }
      const err = bingoAddSignupEntry(st.boardId, name);
      if (err) {
        window.alert(err);
        return;
      }
      dlg?.close();
      renderBingoPublicPreview(readBingoState());
      bingoRenderTeamsSignups(readBingoState());
    });

    signupsRoot?.addEventListener("change", (e) => {
      const teamSel = e.target && e.target.closest && e.target.closest(".bingo-teams-signup-team-select");
      if (!teamSel || teamSel.disabled) return;
      const sid = teamSel.getAttribute("data-bingo-signup-id");
      if (!sid) return;
      const st = readBingoState();
      const nt = normalizeBingoTeams(st);
      const boardId = String(st.boardId || "");
      const entries = bingoGetSignupsForBoard(boardId);
      const entry = entries.find((x) => String(x.id) === sid);
      if (!entry) return;
      bingoMigrateSignupEntry(entry);
      const raw = String(teamSel.value || "");
      const newIdx = raw === "" ? null : parseInt(raw, 10);
      const nextIdx = raw !== "" && Number.isFinite(newIdx) && newIdx >= 0 && newIdx < nt.teamCount ? newIdx : null;
      const oldIdx = entry.rosterTeamIdx != null ? entry.rosterTeamIdx : null;
      if (oldIdx === nextIdx) return;
      if (nextIdx != null && nt.teamCount < 1) {
        teamSel.value = "";
        entry.rosterTeamIdx = null;
        bingoSetSignupsForBoard(boardId, entries);
        window.alert("Add at least one team before assigning sign-ups.");
        return;
      }
      const newState = bingoSetPlayerOnTeamRoster(st, entry.name, oldIdx, nextIdx);
      entry.rosterTeamIdx = nextIdx;
      bingoSetSignupsForBoard(boardId, entries);
      writeBingoState(newState);
      const main = document.getElementById("bingo-access-main");
      if (main && !main.hidden) renderBingoTeamsUi(readBingoState());
      else bingoRenderTeamsSignups(readBingoState());
      renderBingoPublicPreview(readBingoState());
    });
  }

  function renderBingoPublicPreview(state) {
    const nameEl = document.getElementById("bingo-public-board-name");
    const emptyEl = document.getElementById("bingo-public-empty");
    const grid = document.getElementById("bingo-public-grid");
    const teamsWrap = document.getElementById("bingo-public-teams");
    const teamsList = document.getElementById("bingo-public-teams-list");
    if (!grid) return;

    const title = String(state.title || "").trim();
    if (nameEl) nameEl.textContent = title || "Untitled board";

    const statusWrap = document.getElementById("bingo-public-board-status-wrap");
    const statusBadge = document.getElementById("bingo-public-board-status");
    const bs = normalizeBingoBoardStatus(state.boardStatus);

    const tiles = state.tiles || [];
    const rows = bingoClampDim(state.rows);
    const cols = bingoClampDim(state.cols);
    const total = rows * cols;
    const teamsMeta = normalizeBingoTeams(state);
    const teamTileDoneMap = bingoNormalizeTeamTileDone(state, tiles, teamsMeta.teamCount);

    const anyTile = tiles.slice(0, total).some((t) => bingoPublicTileHasDisplayContent(t));
    const hasBoard = !!title || anyTile || teamsMeta.teamCount > 0;
    if (emptyEl) emptyEl.hidden = hasBoard;
    if (statusWrap && statusBadge) {
      statusWrap.hidden = !hasBoard;
      statusBadge.textContent = BINGO_BOARD_STATUS_LABELS[bs];
      statusBadge.className = "bingo-public-board-status bingo-public-board-status--" + bs;
    }

    grid.dataset.bingoRows = String(rows);
    grid.dataset.bingoCols = String(cols);
    grid.classList.toggle("bingo-grid--many", total > 36);
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    let html = "";
    for (let i = 0; i < total; i++) {
      const t = tiles[i] || normalizeBingoTile({}, Math.floor(i / cols), i % cols);
      const tint = BINGO_TINTS.includes(t.tint) ? t.tint : "neutral";
      const done = !!t.done;
      const safeImg = bingoSanitizeImageUrl(t.imageUrl);
      const thumb = safeImg
        ? `<div class="bingo-pub-thumb-wrap"><img class="bingo-pub-thumb" src="${bingoEscapeAttr(safeImg)}" alt="" loading="lazy" /></div>`
        : "";
      const taskRaw = String(t.text || "").trim();
      const task = taskRaw
        ? `<p class="bingo-pub-task">${bingoEscapeTextarea(taskRaw)}</p>`
        : `<p class="bingo-pub-task bingo-pub-task--placeholder">Empty tile</p>`;
      const parts = [];
      const itemLine = bingoFormatItemsForDisplay(t.item);
      if (itemLine) {
        parts.push(`<span><strong>Items</strong> ${bingoEscapeTextarea(itemLine)}</span>`);
      }
      if (String(t.boss || "").trim()) {
        parts.push(`<span><strong>Source</strong> ${bingoEscapeTextarea(String(t.boss).trim())}</span>`);
      }
      const notesTrim = String(t.notes || "").trim();
      if (notesTrim) {
        parts.push(`<span><strong>Notes</strong> ${bingoEscapeTextarea(notesTrim)}</span>`);
      }
      const meta = parts.length > 0 ? `<p class="bingo-pub-meta">${parts.join(" · ")}</p>` : "";
      const hasItemsForTeams = String(t.item || "").trim().length > 0;
      let teamItemsBlock = "";
      if (hasItemsForTeams && teamsMeta.teamCount > 0) {
        const arr = teamTileDoneMap[t.id] || [];
        let gotBtns = "";
        for (let ti = 0; ti < teamsMeta.teamCount; ti++) {
          const got = !!arr[ti];
          const a11y = `Team ${ti + 1} ${got ? "has" : "does not have"} these items`;
          gotBtns += `<span class="bingo-pub-team-got bingo-pub-team-got--display${got ? " bingo-pub-team-got--on" : ""}" data-bingo-tile="${bingoEscapeAttr(t.id)}" data-bingo-team="${ti}" aria-label="${bingoEscapeAttr(a11y)}" title="${bingoEscapeAttr(a11y)} (Terpinheimer plugin)">T${ti + 1}</span>`;
        }
        teamItemsBlock = `<div class="bingo-pub-team-items" role="group" aria-label="Which teams have these items for ${bingoEscapeAttr(t.id)} (read-only on site; plugin can update)">
          <span class="bingo-pub-team-items-label">Teams with items</span>
          <div class="bingo-pub-team-got-row">${gotBtns}</div>
        </div>`;
      }
      html += `<article class="bingo-pub-tile bingo-pub-tile--${tint}${done ? " bingo-pub-tile--done" : ""}" aria-label="Tile ${bingoEscapeAttr(t.id)}">
        <div class="bingo-pub-head">
          <span class="bingo-pub-id">${bingoEscapeAttr(t.id)}</span>
          <span class="bingo-pub-done" aria-hidden="true">${done ? "✓" : ""}</span>
        </div>
        ${thumb}
        ${task}
        ${meta}
        ${teamItemsBlock}
      </article>`;
    }
    grid.innerHTML = html;

    if (teamsWrap && teamsList) {
      if (teamsMeta.teamCount > 0) {
        teamsWrap.hidden = false;
        let tHtml = "";
        for (let ti = 0; ti < teamsMeta.teamCount; ti++) {
          const nm = String(teamsMeta.teamNames[ti] || "").trim();
          const cap = String(teamsMeta.teamCaptains[ti] || "").trim();
          const memRaw = String(teamsMeta.teamMembers[ti] || "");
          const memLines = memRaw
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          const nameLine = nm
            ? `<span class="bingo-pub-team-name">${bingoEscapeTextarea(nm)}</span>`
            : `<span class="bingo-pub-team-name bingo-pub-team-name--placeholder muted">(unnamed)</span>`;
          const captainBlock = cap
            ? `<p class="bingo-pub-team-captain"><strong>Captain</strong> ${bingoEscapeTextarea(cap)}</p>`
            : "";
          const membersBlock = memLines.length
            ? `<ul class="bingo-pub-team-members">${memLines
                .map((m) => `<li>${bingoEscapeTextarea(m)}</li>`)
                .join("")}</ul>`
            : `<p class="bingo-pub-team-members-empty muted">No members listed yet.</p>`;
          tHtml += `<li class="bingo-pub-team-card">
            <div class="bingo-pub-team-card-head">
              <span class="bingo-pub-team-num">Team ${ti + 1}</span>
              ${nameLine}
            </div>
            ${captainBlock}
            <p class="bingo-pub-team-members-label">Members</p>
            ${membersBlock}
          </li>`;
        }
        teamsList.innerHTML = tHtml;
      } else {
        teamsWrap.hidden = true;
        teamsList.innerHTML = "";
      }
    }
  }

  function bingoShowDesignerUnlocked() {
    const gate = document.getElementById("bingo-access-gate");
    const main = document.getElementById("bingo-access-main");
    const pub = document.getElementById("bingo-public-preview");
    if (gate) gate.hidden = true;
    if (main) main.hidden = false;
    if (pub) pub.hidden = true;
    renderBingoGridFromState(readBingoState());
  }

  function bingoShowDesignerLocked() {
    const gate = document.getElementById("bingo-access-gate");
    const main = document.getElementById("bingo-access-main");
    const editGrid = document.getElementById("bingo-grid");
    const pub = document.getElementById("bingo-public-preview");
    if (gate) gate.hidden = false;
    if (main) main.hidden = true;
    if (editGrid) editGrid.innerHTML = "";
    if (pub) pub.hidden = false;
    renderBingoPublicPreview(readBingoState());
  }

  async function bingoRefreshAccessGate() {
    const gate = document.getElementById("bingo-access-gate");
    const main = document.getElementById("bingo-access-main");
    const grid = document.getElementById("bingo-grid");
    const st = document.getElementById("bingo-unlock-status");
    const pub = document.getElementById("bingo-public-preview");
    const openRow = document.getElementById("bingo-session-open-row");
    const setOpenDesignerOffer = (on) => {
      if (openRow) openRow.hidden = !on;
    };

    if (!gate || !main) {
      setOpenDesignerOffer(false);
      if (pub) pub.hidden = true;
      if (grid) renderBingoGridFromState(readBingoState());
      return true;
    }

    try {
      const r = await fetch("/api/event-session", { credentials: "include" });
      const j = await r.json().catch(() => ({}));

      if (r.status === 503) {
        if (st) {
          st.textContent =
            j.error || "CLAN_EVENTS_SECRET is not configured on the server (min 6 characters).";
          st.classList.add("load-error");
          st.classList.remove("muted");
        }
        bingoShowDesignerLocked();
        setOpenDesignerOffer(false);
        return false;
      }

      if (st) {
        st.textContent = "";
        st.classList.remove("load-error");
        st.classList.add("muted");
      }

      if (j.sessionToken) {
        try {
          sessionStorage.setItem(EVENT_SESSION_STORAGE_KEY, j.sessionToken);
        } catch {
          /* ignore */
        }
      }

      bingoShowDesignerLocked();
      setOpenDesignerOffer(!!j.unlocked);
      return !!j.unlocked;
    } catch {
      if (st) {
        st.textContent =
          "Could not reach the site server. Use npm start or your live URL (not a local file) and try again.";
        st.classList.add("load-error");
        st.classList.remove("muted");
      }
    }

    bingoShowDesignerLocked();
    setOpenDesignerOffer(false);
    return false;
  }

  function fillBingoDimSelectsOnce() {
    if (bingoDimsFilled) return;
    bingoDimsFilled = true;
    const rowsSel = document.getElementById("bingo-rows");
    const colsSel = document.getElementById("bingo-cols");
    if (!rowsSel || !colsSel) return;
    for (let n = BINGO_MIN_DIM; n <= BINGO_MAX_DIM; n++) {
      const optR = document.createElement("option");
      optR.value = String(n);
      optR.textContent = String(n);
      rowsSel.appendChild(optR);
      const optC = document.createElement("option");
      optC.value = String(n);
      optC.textContent = String(n);
      colsSel.appendChild(optC);
    }
  }

  function bingoBindPublicPreviewGridOnce() {
    if (bingoPublicPreviewGridBound) return;
    const pubGrid = document.getElementById("bingo-public-grid");
    if (!pubGrid) return;
    bingoPublicPreviewGridBound = true;
  }

  /** Updates team “has items” flags for one tile; used by TerpinheimerBingo.setTeamTileGot (RuneLite). */
  function bingoApplyTeamTileGot(tileId, teamIndex, got) {
    const id = typeof tileId === "string" ? tileId.trim() : "";
    if (!id || !/^r\d+c\d+$/.test(id)) return false;
    const ti = Number(teamIndex);
    if (!Number.isInteger(ti) || ti < 0) return false;
    const want = !!got;
    const st = readBingoState();
    const nt = normalizeBingoTeams(st);
    if (ti >= nt.teamCount) return false;
    const tile = (st.tiles || []).find((t) => t && t.id === id);
    if (!tile || !String(tile.item || "").trim()) return false;
    st.teamTileDone = bingoNormalizeTeamTileDone({ teamTileDone: st.teamTileDone }, st.tiles, nt.teamCount);
    const arr = (st.teamTileDone[id] && st.teamTileDone[id].slice()) || [];
    while (arr.length < nt.teamCount) arr.push(false);
    if (arr.length > nt.teamCount) arr.length = nt.teamCount;
    arr[ti] = want;
    st.teamTileDone[id] = arr;
    writeBingoState(st);
    const main = document.getElementById("bingo-access-main");
    if (main && !main.hidden) renderBingoGridFromState(st);
    else renderBingoPublicPreview(st);
    return true;
  }

  function attachTerpinheimerBingoApi() {
    if (window.TerpinheimerBingo) return;
    window.TerpinheimerBingo = {
      API_VERSION: 1,
      getState() {
        const v = document.getElementById("bingo-view");
        const main = document.getElementById("bingo-access-main");
        if (v && !v.hidden && main && !main.hidden) return collectBingoFromDom();
        return readBingoState();
      },
      getStateJson() {
        return JSON.stringify(window.TerpinheimerBingo.getState());
      },
      getPluginState() {
        return bingoPluginSnapshot(window.TerpinheimerBingo.getState());
      },
      getPluginStateJson() {
        return JSON.stringify(window.TerpinheimerBingo.getPluginState());
      },
      subscribe(callback) {
        if (typeof callback !== "function") return () => {};
        bingoPluginListeners.add(callback);
        try {
          callback(bingoPluginSnapshot(window.TerpinheimerBingo.getState()));
        } catch {
          /* ignore */
        }
        return () => {
          bingoPluginListeners.delete(callback);
        };
      },
      saveState(state) {
        const bingoRoot = document.getElementById("bingo-view");
        if (!bingoRoot || bingoRoot.hidden) return false;
        if (!state || state.v !== 2 || !Array.isArray(state.tiles)) return false;
        const rows = bingoClampDim(state.rows);
        const cols = bingoClampDim(state.cols);
        if (state.tiles.length !== rows * cols) return false;
        const teamsSv = normalizeBingoTeams(state);
        writeBingoState({
          ...state,
          boardStatus: normalizeBingoBoardStatus(state.boardStatus),
          ...teamsSv,
          teamTileDone: bingoNormalizeTeamTileDone(state, state.tiles, teamsSv.teamCount),
        });
        const main = document.getElementById("bingo-access-main");
        const stored = readBingoState();
        if (main && !main.hidden) renderBingoGridFromState(stored);
        else renderBingoPublicPreview(stored);
        return true;
      },
      setTeamTileGot(tileId, teamIndex, got) {
        const bingoRoot = document.getElementById("bingo-view");
        if (!bingoRoot || bingoRoot.hidden) return false;
        return bingoApplyTeamTileGot(tileId, teamIndex, got);
      },
      reloadFromStorage() {
        const main = document.getElementById("bingo-access-main");
        const stored = readBingoState();
        if (main && main.hidden) {
          renderBingoPublicPreview(stored);
          return;
        }
        renderBingoGridFromState(stored);
      },
    };
  }

  function bindBingoPageOnce() {
    if (bingoBindingsDone) return;
    bingoBindingsDone = true;
    bindBingoSignupHandlers();
    bingoBindPublicPreviewGridOnce();
    const grid = document.getElementById("bingo-grid");
    if (!grid) return;

    void startBingoOsrsItemsFetch().then(() => {
      const v = document.getElementById("bingo-view");
      const main = document.getElementById("bingo-access-main");
      if (v && !v.hidden && main && !main.hidden && grid.querySelector(".bingo-tile")) {
        renderBingoGridFromState(readBingoState());
      }
    });

    grid.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.classList && t.classList.contains("bingo-tile-image-url")) {
        const tile = t.closest(".bingo-tile");
        if (tile) bingoRefreshTilePreview(tile, t.value);
      }
      scheduleBingoSave();
    });

    grid.addEventListener("change", (e) => {
      const t = e.target;
      if (t && t.classList && t.classList.contains("bingo-tile-item--multi")) {
        const tile = t.closest(".bingo-tile");
        bingoSyncItemMultiVisuals(tile);
        bingoSyncTeamToggleAvailability(tile);
      }
      const sel = e.target && e.target.closest && e.target.closest(".bingo-tile-tint");
      if (sel) {
        const tile = sel.closest(".bingo-tile");
        if (tile) {
          tile.classList.remove("bingo-tile--neutral", "bingo-tile--easy", "bingo-tile--mass", "bingo-tile--hard");
          const v = BINGO_TINTS.includes(sel.value) ? sel.value : "neutral";
          tile.classList.add(`bingo-tile--${v}`);
        }
      }
      scheduleBingoSave();
    });

    grid.addEventListener("click", (e) => {
      const up = e.target.closest("[data-bingo-upload]");
      if (up) {
        const idx = parseInt(up.getAttribute("data-bingo-upload"), 10);
        if (!Number.isNaN(idx)) {
          bingoImageTargetIndex = idx;
          document.getElementById("bingo-tile-image-file")?.click();
        }
        return;
      }
      const clr = e.target.closest("[data-bingo-clear-img]");
      if (clr) {
        const idx = parseInt(clr.getAttribute("data-bingo-clear-img"), 10);
        const tile = grid.querySelector(`.bingo-tile[data-bingo-index="${idx}"]`);
        if (tile) {
          const inp = tile.querySelector(".bingo-tile-image-url");
          if (inp) inp.value = "";
          bingoRefreshTilePreview(tile, "");
          scheduleBingoSave();
        }
        return;
      }
      const teamBtn = e.target.closest(".bingo-tile-team-got");
      if (teamBtn) {
        if (teamBtn.disabled) return;
        const on = teamBtn.getAttribute("aria-pressed") === "true";
        const next = !on;
        teamBtn.setAttribute("aria-pressed", next ? "true" : "false");
        teamBtn.classList.toggle("bingo-tile-team-got--on", next);
        const tileId = teamBtn.getAttribute("data-bingo-team-tile");
        const teamIdx = parseInt(teamBtn.getAttribute("data-bingo-team-idx") || "-1", 10);
        if (tileId && Number.isFinite(teamIdx) && teamIdx >= 0) {
          const stateWord = next ? "has" : "does not have";
          teamBtn.title = `Team ${teamIdx + 1} ${stateWord} this tile's items`;
        }
        scheduleBingoSave();
        return;
      }
      const btn = e.target.closest(".bingo-tile-toggle");
      if (!btn) return;
      const tile = btn.closest(".bingo-tile");
      const pressed = btn.getAttribute("aria-pressed") === "true";
      const next = !pressed;
      btn.setAttribute("aria-pressed", next ? "true" : "false");
      btn.textContent = next ? "✓" : "○";
      if (tile) tile.classList.toggle("bingo-tile--done", next);
      scheduleBingoSave();
      bingoUpdateProgress();
    });

    document.getElementById("bingo-board-title")?.addEventListener("input", () => scheduleBingoSave());

    document.getElementById("bingo-board-status")?.addEventListener("change", () => scheduleBingoSave());

    document.getElementById("bingo-toggle-advanced")?.addEventListener("click", () => {
      const on = !bingoReadAdvancedOpen();
      bingoWriteAdvancedOpen(on);
      bingoApplyAdvancedToggleUi();
    });

    document.getElementById("bingo-team-count")?.addEventListener("change", () => {
      const s0 = readBingoState();
      const sel = document.getElementById("bingo-team-count");
      const newN = Math.min(BINGO_TEAM_COUNT_MAX, Math.max(0, parseInt(String(sel && sel.value != null ? sel.value : "0"), 10) || 0));
      const scraped = scrapeBingoTeamColumnsFromDom();
      let merged = normalizeBingoTeams(
        scraped
          ? {
              teamCount: newN,
              teamNames: scraped.teamNames,
              teamCaptains: scraped.teamCaptains,
              teamMembers: scraped.teamMembers,
            }
          : { teamCount: newN }
      );
      bingoClampSignupsToTeamCount(s0.boardId, merged.teamCount);
      renderBingoTeamColumns(merged);
      bingoRenderTeamsSignups({ ...s0, ...merged });
      const stNow = collectBingoFromDom();
      writeBingoState(stNow);
      renderBingoGridFromState(stNow);
    });

    document.getElementById("bingo-team-names")?.addEventListener("input", (e) => {
      const t = e.target;
      if (
        t &&
        t.classList &&
        (t.classList.contains("bingo-team-name-input") ||
          t.classList.contains("bingo-team-captain-input") ||
          t.classList.contains("bingo-team-members-textarea"))
      ) {
        scheduleBingoSave();
      }
    });

    document.getElementById("bingo-apply-dims")?.addEventListener("click", () => {
      const rowsSel = document.getElementById("bingo-rows");
      const colsSel = document.getElementById("bingo-cols");
      const newRows = bingoClampDim(rowsSel && rowsSel.value);
      const newCols = bingoClampDim(colsSel && colsSel.value);
      let state = collectBingoFromDom();
      const oldN = state.rows * state.cols;
      const newN = newRows * newCols;
      if (newN < oldN) {
        if (
          !window.confirm(
            `Shrink to ${newRows}×${newCols}? ${oldN - newN} tile(s) at the bottom-right will be removed.`
          )
        )
          return;
      }
      state = resizeBingoState(state, newRows, newCols);
      writeBingoState(state);
      renderBingoGridFromState(state);
    });

    document.getElementById("bingo-copy-id")?.addEventListener("click", async () => {
      const idEl = document.getElementById("bingo-board-id");
      const t = idEl ? idEl.textContent.trim() : "";
      if (!t || t === "—") return;
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        try {
          idEl.focus();
          document.execCommand("selectAll");
          document.execCommand("copy");
        } catch {
          /* ignore */
        }
      }
    });

    document.getElementById("bingo-open-designer-btn")?.addEventListener("click", () => {
      bingoShowDesignerUnlocked();
    });

    document.getElementById("bingo-exit-designer")?.addEventListener("click", async () => {
      try {
        await fetch("/api/event-session", { method: "DELETE", credentials: "include" });
      } catch {
        /* offline or old server without DELETE */
      }
      try {
        sessionStorage.removeItem(EVENT_SESSION_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      const st = document.getElementById("bingo-unlock-status");
      if (st) {
        st.textContent = "";
        st.classList.remove("load-error");
        st.classList.add("muted");
      }
      void bingoRefreshAccessGate();
    });

    document.getElementById("bingo-clear-done")?.addEventListener("click", () => {
      grid.querySelectorAll(".bingo-tile-toggle").forEach((b) => {
        b.setAttribute("aria-pressed", "false");
        b.textContent = "○";
        const t = b.closest(".bingo-tile");
        if (t) t.classList.remove("bingo-tile--done");
      });
      scheduleBingoSave();
      bingoUpdateProgress();
    });

    document.getElementById("bingo-reset-board")?.addEventListener("click", () => {
      if (
        !window.confirm(
          "Reset to a fresh 5×5 board? Tile text and images are cleared. Your board ID stays the same for plugin sync."
        )
      )
        return;
      const id = readBingoState().boardId;
      const fresh = defaultBingoState();
      fresh.boardId = id;
      writeBingoState(fresh);
      renderBingoGridFromState(fresh);
    });

    document.getElementById("bingo-export")?.addEventListener("click", () => {
      const main = document.getElementById("bingo-access-main");
      if (main && main.hidden) {
        window.alert("Unlock the bingo designer with the clan events secret first.");
        return;
      }
      const data = collectBingoFromDom();
      const slug = (data.title || "board")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `terpinheimer-bingo-${slug || "board"}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const fileInput = document.getElementById("bingo-import-file");
    document.getElementById("bingo-import-btn")?.addEventListener("click", () => fileInput && fileInput.click());

    fileInput?.addEventListener("change", () => {
      const main = document.getElementById("bingo-access-main");
      if (main && main.hidden) {
        fileInput.value = "";
        window.alert("Unlock the bingo designer with the clan events secret first.");
        return;
      }
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const o = JSON.parse(String(reader.result || ""));
          let state = null;
          if (o.v === 1 && Array.isArray(o.tiles) && o.tiles.length === 25) state = migrateBingoV1ToV2(o);
          else if (o.v === 2 && Array.isArray(o.tiles)) {
            const rows = bingoClampDim(o.rows);
            const cols = bingoClampDim(o.cols);
            if (o.tiles.length !== rows * cols) {
              window.alert("Invalid file: rows×columns must match number of tiles.");
              fileInput.value = "";
              return;
            }
            let idx = 0;
            const tiles = [];
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                tiles.push(normalizeBingoTile(o.tiles[idx] || {}, r, c));
                idx++;
              }
            }
            const teamsImp = normalizeBingoTeams(o);
            state = {
              v: 2,
              boardId: typeof o.boardId === "string" && o.boardId.length >= 6 ? o.boardId : bingoNewBoardId(),
              title: typeof o.title === "string" ? o.title.slice(0, 120) : "",
              boardStatus: normalizeBingoBoardStatus(o.boardStatus),
              rows,
              cols,
              tiles,
              ...teamsImp,
              teamTileDone: bingoNormalizeTeamTileDone(o, tiles, teamsImp.teamCount),
            };
          }
          if (!state) {
            window.alert("Invalid bingo file. Expected version 2 (or legacy version 1 with 25 tiles).");
            fileInput.value = "";
            return;
          }
          writeBingoState(state);
          renderBingoGridFromState(state);
        } catch {
          window.alert("Could not read that JSON file.");
        }
        fileInput.value = "";
      };
      reader.readAsText(f);
    });

    const imgFile = document.getElementById("bingo-tile-image-file");
    imgFile?.addEventListener("change", () => {
      const f = imgFile.files && imgFile.files[0];
      imgFile.value = "";
      if (f == null || bingoImageTargetIndex == null) return;
      const idx = bingoImageTargetIndex;
      bingoImageTargetIndex = null;
      if (!f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        let dataUrl = String(reader.result || "");
        const apply = (url) => {
          const tile = grid.querySelector(`.bingo-tile[data-bingo-index="${idx}"]`);
          if (!tile) return;
          const inp = tile.querySelector(".bingo-tile-image-url");
          if (inp) inp.value = url;
          bingoRefreshTilePreview(tile, url);
          scheduleBingoSave();
        };
        if (dataUrl.length <= BINGO_MAX_IMAGE_CHARS) {
          apply(dataUrl);
          return;
        }
        bingoShrinkDataUrl(dataUrl, BINGO_MAX_IMAGE_CHARS, (small) => {
          if (small) apply(small);
          else
            window.alert(
              "Image is too large even after shrinking. Try a smaller file or host it online and paste the URL."
            );
        });
      };
      reader.readAsDataURL(f);
    });

    document.getElementById("bingo-unlock-btn")?.addEventListener("click", async () => {
      const inp = document.getElementById("bingo-unlock-code");
      const st = document.getElementById("bingo-unlock-status");
      const code = String(inp?.value || "").trim();
      if (code.length < MIN_ORGANIZER_CODE_LEN) {
        if (st) {
          st.textContent = `Enter the secret (at least ${MIN_ORGANIZER_CODE_LEN} characters).`;
          st.classList.add("load-error");
          st.classList.remove("muted");
        }
        return;
      }
      if (st) {
        st.textContent = "";
        st.classList.remove("load-error");
        st.classList.add("muted");
      }
      try {
        const r = await fetch("/api/event-session", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: code }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (st) {
            let msg = j.error || "Invalid code.";
            if (r.status === 503 && String(msg).includes("CLAN_EVENTS_SECRET")) {
              msg +=
                " Set CLAN_EVENTS_SECRET on the server (e.g. Render → Environment → CLAN_EVENTS_SECRET).";
            }
            st.textContent = msg;
            st.classList.add("load-error");
            st.classList.remove("muted");
          }
          return;
        }
        if (inp) inp.value = "";
        if (j.sessionToken) {
          try {
            sessionStorage.setItem(EVENT_SESSION_STORAGE_KEY, j.sessionToken);
          } catch {
            /* ignore */
          }
        }
        if (st) {
          st.textContent = "Unlocked — same session as Events (cookie + optional session token).";
          st.classList.remove("load-error");
          st.classList.add("muted");
        }
        bingoShowDesignerUnlocked();
      } catch {
        if (st) {
          st.textContent = "Could not reach the server.";
          st.classList.add("load-error");
          st.classList.remove("muted");
        }
      }
    });
  }

  function showBingoView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (bingov) bingov.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Bingo | Terpinheimer";
    fillBingoDimSelectsOnce();
    bindBingoPageOnce();
    void bingoRefreshAccessGate();
  }

  let adminPageBound = false;
  function setAdminStatus(elId, text, isError) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("load-error", !!isError);
    el.classList.toggle("muted", !isError);
  }

  async function refreshAdminSessionStatus() {
    const signupPanel = document.getElementById("admin-signup-panel");
    const resetPanel = document.getElementById("admin-reset-panel");
    try {
      const r = await fetch("/api/admin/me", { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (j.authenticated && j.admin?.email) {
        setAdminStatus("admin-auth-status", `Logged in as ${j.admin.email}`, false);
        if (signupPanel) signupPanel.hidden = false;
        if (resetPanel) resetPanel.hidden = false;
        return;
      }
      setAdminStatus("admin-auth-status", "Not logged in.", false);
      if (signupPanel) signupPanel.hidden = true;
      if (resetPanel) resetPanel.hidden = true;
    } catch {
      setAdminStatus("admin-auth-status", "Could not reach the server.", true);
      if (signupPanel) signupPanel.hidden = true;
      if (resetPanel) resetPanel.hidden = true;
    }
  }

  function bindAdminPageOnce() {
    if (adminPageBound) return;
    adminPageBound = true;

    const loginForm = document.getElementById("admin-login-form");
    loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      const payload = {
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
      };
      setAdminStatus("admin-login-status", "Logging in...", false);
      try {
        const r = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setAdminStatus("admin-login-status", j.error || "Login failed.", true);
          return;
        }
        setAdminStatus("admin-login-status", "Login successful.", false);
        loginForm.reset();
        await refreshAdminSessionStatus();
      } catch {
        setAdminStatus("admin-login-status", "Could not reach the server.", true);
      }
    });

    const signupForm = document.getElementById("admin-signup-form");
    signupForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(signupForm);
      const payload = {
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
        signupKey: String(fd.get("signupKey") || ""),
      };
      setAdminStatus("admin-signup-status", "Creating admin...", false);
      try {
        const r = await fetch("/api/admin/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setAdminStatus("admin-signup-status", j.error || "Could not create admin.", true);
          return;
        }
        setAdminStatus("admin-signup-status", "Admin created.", false);
        signupForm.reset();
      } catch {
        setAdminStatus("admin-signup-status", "Could not reach the server.", true);
      }
    });

    const resetForm = document.getElementById("admin-reset-form");
    resetForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(resetForm);
      const payload = {
        email: String(fd.get("email") || "").trim(),
        newPassword: String(fd.get("newPassword") || ""),
        ownerResetKey: String(fd.get("ownerResetKey") || ""),
      };
      setAdminStatus("admin-reset-status", "Resetting password...", false);
      try {
        const r = await fetch("/api/admin/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setAdminStatus("admin-reset-status", j.error || "Password reset failed.", true);
          return;
        }
        setAdminStatus("admin-reset-status", `Password reset for ${j.email || payload.email}.`, false);
        resetForm.reset();
      } catch {
        setAdminStatus("admin-reset-status", "Could not reach the server.", true);
      }
    });

    const deleteForm = document.getElementById("admin-delete-form");
    deleteForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(deleteForm);
      const payload = {
        email: String(fd.get("email") || "").trim(),
        ownerResetKey: String(fd.get("ownerResetKey") || ""),
      };
      if (!window.confirm(`Delete admin account ${payload.email}? This cannot be undone.`)) return;
      setAdminStatus("admin-delete-status", "Deleting admin account...", false);
      try {
        const r = await fetch("/api/admin/delete-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setAdminStatus("admin-delete-status", j.error || "Delete failed.", true);
          return;
        }
        setAdminStatus("admin-delete-status", `Deleted ${j.email || payload.email}.`, false);
        deleteForm.reset();
      } catch {
        setAdminStatus("admin-delete-status", "Could not reach the server.", true);
      }
    });

    const logoutBtn = document.getElementById("admin-logout-btn");
    logoutBtn?.addEventListener("click", async () => {
      setAdminStatus("admin-auth-status", "Logging out...", false);
      try {
        await fetch("/api/admin/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* ignore */
      }
      await refreshAdminSessionStatus();
    });
  }

  function showAdminView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (adminv) adminv.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Admin | Terpinheimer";
    bindAdminPageOnce();
    void refreshAdminSessionStatus();
  }


  function applyRoute() {
    const raw = window.location.hash ? window.location.hash.slice(1) : "/";
    let path = raw.startsWith("/") ? raw : `/${raw}`;
    path = path.split("?")[0].replace(/\/+$/, "") || "/";

    const segs = path.split("/").filter(Boolean);
    const routeRoot = segs[0]?.toLowerCase();
    if (routeRoot === "hiscores" || routeRoot === "members") {
      const slug = segs.slice(1).join("/");
      if (slug) {
        openMemberPage(slug);
        return;
      }
      showMembersListView();
      return;
    }

    if (path === "/events") {
      showEventsCalendarView();
      return;
    }

    if (path === "/plugin") {
      showPluginView();
      return;
    }

    if (path === "/bingo") {
      showBingoView();
      return;
    }

    if (path === "/map") {
      showMapView();
      return;
    }

    if (path === "/admin") {
      showAdminView();
      return;
    }

    showHomeView();

    if (path === "/" || path === "") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function womPlayerUrl(username) {
    return `https://wiseoldman.net/players/${encodeURIComponent(username)}`;
  }

  function unwrapList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.value)) return data.value;
    return [];
  }

  async function womGet(path) {
    const base = womFetchBase();
    const maxAttempts = 3;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const wait = womRetryDelay(attempt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await fetch(`${base}${path}`, {
          headers: { Accept: "application/json" },
        });
        if (!r.ok) {
          const st = r.status;
          lastErr = new Error(`${path}: ${st}`);
          if (attempt < maxAttempts - 1 && (st === 429 || st >= 500)) continue;
          throw lastErr;
        }
        return r.json();
      } catch (e) {
        lastErr = e;
        const msg = e && typeof e.message === "string" ? e.message : "";
        const http = msg.match(/: (\d{3})$/);
        if (http) {
          const st = Number(http[1]);
          if (attempt < maxAttempts - 1 && (st === 429 || st >= 500)) continue;
        } else if (attempt < maxAttempts - 1) {
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr;
  }

  /** Sum every roster member's delta for a metric/period (WOM gained has no max limit; paginate by offset). */
  const WOM_GAINED_PAGE = 500;
  async function womGetAllGroupGained(metric) {
    const all = [];
    let offset = 0;
    for (;;) {
      const q = new URLSearchParams({
        metric,
        period: "month",
        limit: String(WOM_GAINED_PAGE),
        offset: String(offset),
      });
      const data = await womGet(`/groups/${WOM_GROUP_ID}/gained?${q}`);
      const page = unwrapList(data);
      all.push(...page);
      if (page.length < WOM_GAINED_PAGE) break;
      offset += WOM_GAINED_PAGE;
    }
    return all;
  }

  /** Full group hiscores for one metric (no max limit; paginate). Used for clan-wide lifetime clue / collection totals. */
  const WOM_HISCORES_PAGE = 500;
  async function womGetAllGroupHiscores(metric) {
    const all = [];
    let offset = 0;
    for (;;) {
      const q = new URLSearchParams({
        metric,
        limit: String(WOM_HISCORES_PAGE),
        offset: String(offset),
      });
      const data = await womGet(`/groups/${WOM_GROUP_ID}/hiscores?${q}`);
      const page = unwrapList(data);
      all.push(...page);
      if (page.length < WOM_HISCORES_PAGE) break;
      offset += WOM_HISCORES_PAGE;
    }
    return all;
  }

  function sumMembershipTotalExp(memberships) {
    return memberships.reduce((s, m) => {
      const x = m.player?.exp;
      return s + (typeof x === "number" ? x : 0);
    }, 0);
  }

  function sumGroupBossKills(rows) {
    return rows.reduce((s, row) => {
      const k = row.data?.kills;
      return s + (typeof k === "number" ? k : 0);
    }, 0);
  }

  /** Sum kill counts for every boss WOM tracks, across the full roster (paginated hiscores per boss). */
  async function womGetClanTotalBossKills() {
    let total = 0;
    const batchSize = 12;
    for (let i = 0; i < WOM_BOSS_METRICS.length; i += batchSize) {
      const batch = WOM_BOSS_METRICS.slice(i, i + batchSize);
      const parts = await Promise.all(
        batch.map((metric) => womGetAllGroupHiscores(metric).then(sumGroupBossKills).catch(() => 0))
      );
      total += parts.reduce((a, b) => a + b, 0);
    }
    return total;
  }

  /** Activity hiscores use data.score; skills use data.experience. */
  function sumGroupHiscoreValues(rows) {
    return rows.reduce((s, row) => {
      const d = row.data;
      if (!d) return s;
      if (typeof d.score === "number") return s + d.score;
      if (typeof d.experience === "number") return s + d.experience;
      return s;
    }, 0);
  }

  function fmtCompact(n) {
    const x = Math.abs(n);
    if (x >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (x >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (x >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${Math.round(n)}`;
  }

  function fmtXp(n) {
    return Math.round(n).toLocaleString();
  }

  function formatAccountType(p) {
    const map = { ironman: "Iron", hardcore: "HCIM", ultimate: "UIM", regular: "Main", unknown: "?" };
    let s = map[p.type] || p.type || "?";
    if (p.build && p.build !== "main") s += ` (${p.build.replace(/_/g, " ")})`;
    return s;
  }

  function escHtml(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function relTime(iso) {
    const t = new Date(iso).getTime();
    const d = Math.floor((Date.now() - t) / MS_DAY);
    if (d <= 0) return "today";
    if (d === 1) return "1d ago";
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  /** Wise Old Man collection log delta — links to on-site member profile (RuneProfile) like the roster. */
  function formatCollectionGainedRow(row) {
    const p = row.player;
    const name = p?.displayName || p?.username || "?";
    const href = p?.username ? memberProfileHref(p.username) : "#/members";
    const raw = row.endDate ? String(row.endDate).replace(" ", "T") : "";
    const when = raw
      ? new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "";
    const gained = row.data && typeof row.data.gained === "number" ? row.data.gained : 0;
    const total = row.data && typeof row.data.end === "number" && row.data.end >= 0 ? row.data.end : null;
    const totalBit =
      total != null ? ` <span class="muted">(${total} slots logged)</span>` : "";
    return `<time>${escHtml(when)}</time> — <a href="${escHtml(href)}" class="wom-link">${escHtml(
      name
    )}</a> · +${escHtml(String(gained))} new${totalBit}`;
  }

  function applyDiscordInviteLinks() {
    document.querySelectorAll("[data-discord-link]").forEach((a) => {
      a.href = DISCORD_INVITE_URL;
    });
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function isSafeHttpUrl(s) {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }

  function normalizeCalendarEvents(competitions, customEvents) {
    const out = [];
    for (const c of competitions) {
      if (c.visible === false) continue;
      const start = new Date(c.startsAt).getTime();
      const end = new Date(c.endsAt).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      out.push({
        kind: "wom",
        title: c.title || "Competition",
        start,
        end,
        link: `https://wiseoldman.net/competitions/${c.id}`,
      });
    }
    for (const e of customEvents) {
      if (!e || !e.title || !e.startsAt || !e.endsAt) continue;
      const start = new Date(e.startsAt).getTime();
      const end = new Date(e.endsAt).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      const link = e.link && isSafeHttpUrl(e.link) ? e.link : null;
      out.push({
        kind: "clan",
        title: e.title,
        start,
        end,
        link,
        notes: e.notes,
        id: e.id,
      });
    }
    return out;
  }

  function eventTouchesCalendarDay(ev, dateObj) {
    const y = dateObj.getFullYear();
    const mo = dateObj.getMonth();
    const d = dateObj.getDate();
    const dayStart = new Date(y, mo, d, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(y, mo, d, 23, 59, 59, 999).getTime();
    return ev.start <= dayEnd && ev.end >= dayStart;
  }

  function refreshEventCache(competitions, customEvents) {
    cachedCompetitions = competitions;
    cachedCalendarEvents = normalizeCalendarEvents(competitions, customEvents);
    renderCalendarIfVisible();
  }

  function renderCalendarIfVisible() {
    const evw = document.getElementById("events-view");
    if (!evw || evw.hidden) return;
    renderCalendarGrid();
  }

  function renderCalendarGrid() {
    const grid = document.getElementById("calendar-grid");
    const label = document.getElementById("cal-month-label");
    if (!grid || !label) return;

    const { y, m } = calendarCursor;
    label.textContent = new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

    const today = new Date();
    const dowHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    let html = '<div class="cal-row cal-row--dow" role="row">';
    for (const w of dowHeaders) {
      html += `<div class="cal-cell cal-cell--dow" role="columnheader">${escHtml(w)}</div>`;
    }
    html += "</div>";

    for (let i = 0; i < totalCells; i++) {
      if (i % 7 === 0) html += '<div class="cal-row" role="row">';

      const cellDate = new Date(y, m, 1 - firstDow + i);
      const inMonth = cellDate.getMonth() === m;
      const isToday =
        cellDate.getDate() === today.getDate() &&
        cellDate.getMonth() === today.getMonth() &&
        cellDate.getFullYear() === today.getFullYear();

      const dayEvents = cachedCalendarEvents.filter((ev) => eventTouchesCalendarDay(ev, cellDate));
      dayEvents.sort((a, b) => a.start - b.start);

      const dayNum = cellDate.getDate();
      const mutedClass = inMonth ? "" : " cal-cell--muted";
      const todayClass = isToday ? " cal-cell--today" : "";

      const maxShow = 3;
      const shown = dayEvents.slice(0, maxShow);
      const more = dayEvents.length - shown.length;
      let chips = "";
      for (const ev of shown) {
        const chipClass = ev.kind === "wom" ? "cal-chip cal-chip--wom" : "cal-chip cal-chip--clan";
        const timeStr = new Date(ev.start).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const tip = `${timeStr} · ${ev.title}`;
        const t = escHtml(ev.title);
        const inner = ev.link
          ? `<a href="${escHtml(ev.link)}" target="_blank" rel="noopener noreferrer" class="cal-chip-link">${t}</a>`
          : `<span class="cal-chip-text">${t}</span>`;
        const idAttr =
          ev.kind === "clan" && ev.id ? ` data-clan-event-id="${escHtml(String(ev.id))}"` : "";
        const removeBtn =
          ev.kind === "clan" && ev.id
            ? `<button type="button" class="cal-chip-remove" aria-label="Remove this clan event">×</button>`
            : "";
        chips += `<div class="${chipClass}" title="${escHtml(tip)}"${idAttr}><span class="cal-chip-inner">${inner}</span>${removeBtn}</div>`;
      }
      if (more > 0) chips += `<div class="cal-more muted">+${more} more</div>`;

      html += `<div class="cal-cell${mutedClass}${todayClass}" role="gridcell">`;
      html += `<span class="cal-day-num">${dayNum}</span>`;
      html += `<div class="cal-chips">${chips}</div>`;
      html += "</div>";

      if (i % 7 === 6) html += "</div>";
    }

    grid.innerHTML = html;
  }

  async function load() {
    const customEventsPromise = fetch("/api/custom-events", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return [];
        try {
          const j = await r.json();
          return Array.isArray(j) ? j : [];
        } catch {
          return [];
        }
      })
      .catch(() => []);

    const paths = {
      group: `/groups/${WOM_GROUP_ID}`,
      hiscores: `/groups/${WOM_GROUP_ID}/hiscores?metric=overall&limit=15`,
      achievements: `/groups/${WOM_GROUP_ID}/achievements?limit=12`,
      competitions: `/groups/${WOM_GROUP_ID}/competitions?limit=30`,
    };

    const results = await Promise.allSettled([
      womGet(paths.group),
      womGetAllGroupGained("overall"),
      womGet(paths.hiscores),
      womGetAllGroupGained("collections_logged"),
      womGetAllGroupHiscores("clue_scrolls_all"),
      womGetAllGroupHiscores("collections_logged"),
      womGetClanTotalBossKills(),
      womGet(paths.achievements),
      womGet(paths.competitions),
    ]);

    const errEl = document.getElementById("load-error");
    const group = results[0].status === "fulfilled" ? results[0].value : null;
    if (!group) {
      cachedMemberships = [];
      cachedCompetitions = [];
      const membersMeta = document.getElementById("members-list-meta");
      if (membersMeta) membersMeta.textContent = "Could not load roster from Wise Old Man.";
      renderMembersListIfVisible();
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent =
          results[0].status === "rejected"
            ? womLoadErrorHint(results[0].reason)
            : "Could not load group.";
      }
      const customEvents = await customEventsPromise;
      refreshEventCache([], customEvents);
      await refreshHomeLiveMapPresence();
      startHomeLiveMapPoll();
      return;
    }

    if (errEl) errEl.hidden = true;

    const gainedXp = results[1].status === "fulfilled" ? unwrapList(results[1].value) : [];
    const hiscores = results[2].status === "fulfilled" ? unwrapList(results[2].value) : [];
    const gainedColl = results[3].status === "fulfilled" ? unwrapList(results[3].value) : [];
    const clueHiscores = results[4].status === "fulfilled" ? results[4].value : [];
    const collectionsHiscores = results[5].status === "fulfilled" ? results[5].value : [];
    const clanBossKills =
      results[6].status === "fulfilled" && typeof results[6].value === "number" ? results[6].value : 0;
    const achievements = results[7].status === "fulfilled" ? unwrapList(results[7].value) : [];
    const competitions = results[8].status === "fulfilled" ? unwrapList(results[8].value) : [];

    const memberships = group.memberships || [];
    cachedMemberships = memberships;
    const membersMeta = document.getElementById("members-list-meta");
    if (membersMeta) {
      const n = group.memberCount ?? memberships.length;
      membersMeta.textContent = `${n} ${n === 1 ? "member" : "members"} on the Wise Old Man roster — search, jump by letter, or open a name for their RuneProfile.`;
    }
    renderMembersListIfVisible();

    applyDiscordInviteLinks();

    const tagline = document.getElementById("hero-tagline");
    if (tagline) {
      const bits = [group.description || "OSRS PvM & social clan"];
      if (group.homeworld) bits.push(`World ${group.homeworld}`);
      bits.push("Stats from Wise Old Man");
      tagline.textContent = bits.join(" · ");
    }

    const welcome = document.getElementById("welcome-lead");
    if (welcome) {
      const d = escHtml(group.description || "").trim();
      welcome.innerHTML = `${d ? `${d} ` : ""}Member list, gains, and hiscores sync from <a href="${WOM_GROUP_URL}" target="_blank" rel="noopener" class="wom-link">Terpinheimer on Wise Old Man</a>.`;
    }

    const stat = (key, val) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = val;
    };

    stat("members", String(group.memberCount ?? memberships.length));
    stat("xp", fmtCompact(sumMembershipTotalExp(memberships)));
    stat("bosses", fmtCompact(clanBossKills));
    stat("clues", String(Math.round(sumGroupHiscoreValues(clueHiscores))));
    stat("collections", String(Math.round(sumGroupHiscoreValues(collectionsHiscores))));

    const monthEl = document.getElementById("top-month");
    if (monthEl) {
      monthEl.innerHTML = gainedXp
        .slice(0, 10)
        .map((row) => {
          const p = row.player;
          const name = p?.displayName || p?.username || "?";
          const u = p?.username ? memberProfileHref(p.username) : "#/";
          const g = row.data?.gained ?? 0;
          return `<li><strong><a href="${u}" class="wom-link">${escHtml(name)}</a></strong> — +${fmtCompact(g)} XP</li>`;
        })
        .join("");
      if (!gainedXp.length) monthEl.innerHTML = "<li>No monthly gain data yet.</li>";
    }

    const overallEl = document.getElementById("top-overall");
    if (overallEl) {
      overallEl.innerHTML = hiscores
        .map((row, i) => {
          const p = row.player;
          const name = p?.displayName || p?.username || "?";
          const u = p?.username ? memberProfileHref(p.username) : "#/";
          const lvl = row.data?.level ?? "—";
          const xp = row.data?.experience != null ? fmtXp(row.data.experience) : "—";
          return `<tr><td>${i + 1}</td><td><a href="${u}" class="wom-link">${escHtml(name)}</a></td><td>${formatAccountType(p)}</td><td>${lvl}</td><td>${xp}</td></tr>`;
        })
        .join("");
      if (!hiscores.length) overallEl.innerHTML = "<tr><td colspan=\"5\">No hiscore data.</td></tr>";
    }

    const customEvents = await customEventsPromise;
    refreshEventCache(competitions, customEvents);

    const act = document.getElementById("activity");
    if (act) {
      const collActivity = gainedColl
        .filter((row) => (row.data?.gained ?? 0) > 0)
        .sort((a, b) => {
          const ta = new Date(a.endDate || a.player?.lastChangedAt || 0).getTime();
          const tb = new Date(b.endDate || b.player?.lastChangedAt || 0).getTime();
          if (tb !== ta) return tb - ta;
          return (b.data?.gained || 0) - (a.data?.gained || 0);
        })
        .slice(0, 20);
      const womRows = collActivity.map((row) => `<li>${formatCollectionGainedRow(row)}</li>`);
      const womFallbackHtml = womRows.length
        ? womRows.join("")
        : "<li class=\"muted\">No recent collection log gains on the roster this month. Wise Old Man updates when players sync.</li>";
      act.innerHTML =
        '<li class="muted">Loading drops &amp; collection items from RuneProfile…</li>';
      void hydrateClanActivityItemFeed(collActivity, womFallbackHtml, act);
    }

    const ach = document.getElementById("achievements");
    if (ach) {
      const rows = achievements.map((a) => {
        const p = a.player;
        const name = p?.displayName || p?.username || "?";
        const u = p?.username ? womPlayerUrl(p.username) : WOM_GROUP_URL;
        const when = new Date(a.createdAt).toLocaleDateString();
        return `<li><a href="${u}" target="_blank" rel="noopener" class="wom-link">${name}</a> — ${a.name} <span class="ach-date">(${when})</span></li>`;
      });
      ach.innerHTML = rows.length ? rows.join("") : "<li>No recent achievements logged.</li>";
    }

    await refreshHomeLiveMapPresence();
    startHomeLiveMapPoll();
  }

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  document.getElementById("members-list-view")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".members-alpha-btn[data-scrollto]");
    if (!btn) return;
    const id = btn.getAttribute("data-scrollto");
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("cal-prev")?.addEventListener("click", () => {
    calendarCursor.m -= 1;
    if (calendarCursor.m < 0) {
      calendarCursor.m = 11;
      calendarCursor.y -= 1;
    }
    renderCalendarIfVisible();
  });
  document.getElementById("cal-next")?.addEventListener("click", () => {
    calendarCursor.m += 1;
    if (calendarCursor.m > 11) {
      calendarCursor.m = 0;
      calendarCursor.y += 1;
    }
    renderCalendarIfVisible();
  });
  document.getElementById("cal-today")?.addEventListener("click", () => {
    calendarCursor = initialCalendarCursor();
    renderCalendarIfVisible();
  });

  document.getElementById("calendar-grid")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".cal-chip-remove");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const chip = btn.closest("[data-clan-event-id]");
    const id = chip?.getAttribute("data-clan-event-id");
    if (!id) return;
    let code = getOrganizerSecretInput();
    if (code.length < MIN_ORGANIZER_CODE_LEN) {
      code = String(
        window.prompt("Enter leadership code to remove this event:") || ""
      ).trim();
    }
    if (code.length < MIN_ORGANIZER_CODE_LEN) {
      window.alert(
        "You must enter the leadership code (at least 6 characters) to remove an event. You can type it in the box under Add clan event first, or use this prompt."
      );
      return;
    }
    if (!window.confirm("Remove this clan event from the calendar?")) return;
    try {
      const r = await fetch(`/api/custom-events?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert(j.error || "Could not remove event.");
        return;
      }
      const listR = await fetch("/api/custom-events", { credentials: "include" });
      let list = [];
      if (listR.ok) {
        try {
          const parsed = await listR.json();
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          /* ignore */
        }
      }
      refreshEventCache(cachedCompetitions, list);
    } catch {
      window.alert("Could not reach the server.");
    }
  });

  document.getElementById("event-unlock-btn")?.addEventListener("click", async () => {
    const inp = document.getElementById("event-unlock-code");
    const st = document.getElementById("event-unlock-status");
    const code = String(inp?.value || "").trim();
    if (!code) {
      if (st) {
        st.textContent = "Enter the code.";
        st.classList.add("load-error");
        st.classList.remove("muted");
      }
      return;
    }
    if (st) {
      st.textContent = "";
      st.classList.remove("load-error");
      st.classList.add("muted");
    }
    try {
      const r = await fetch("/api/event-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: code }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (st) {
          let msg = j.error || "Invalid code.";
          if (
            r.status === 503 &&
            String(msg).includes("CLAN_EVENTS_SECRET")
          ) {
            msg +=
              " The live server needs this variable in its environment (e.g. Render → Environment → CLAN_EVENTS_SECRET).";
          }
          st.textContent = msg;
          st.classList.add("load-error");
          st.classList.remove("muted");
        }
        return;
      }
      if (inp) inp.value = "";
      if (j.sessionToken) {
        try {
          sessionStorage.setItem(EVENT_SESSION_STORAGE_KEY, j.sessionToken);
        } catch {
          /* ignore */
        }
      }
      if (st) {
        st.textContent = "Unlocked — you can add events for this browser session.";
        st.classList.remove("load-error");
        st.classList.add("muted");
      }
      applyEventFormUnlocked(true);
    } catch {
      if (st) {
        st.textContent = "Could not reach the server.";
        st.classList.add("load-error");
        st.classList.remove("muted");
      }
    }
  });

  document.getElementById("event-add-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const status = document.getElementById("event-add-status");
    if (!status) return;
    status.textContent = "";
    status.classList.remove("load-error");
    status.classList.add("muted");

    const auth = await resolveClanEventsAuth();
    if (!auth) {
      status.textContent =
        "Enter the leadership code (at least 6 characters) or use Unlock above.";
      status.classList.remove("muted");
      status.classList.add("load-error");
      return;
    }

    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const startsRaw = String(fd.get("startsAt") || "");
    const endsRaw = String(fd.get("endsAt") || "");
    const startMs = parseDatetimeLocalInput(startsRaw);
    const endMs = parseDatetimeLocalInput(endsRaw);
    if (!title || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      status.textContent = "Please fill in title and valid start/end times.";
      status.classList.remove("muted");
      status.classList.add("load-error");
      return;
    }
    if (endMs < startMs) {
      status.textContent = "End time must be on or after start.";
      status.classList.remove("muted");
      status.classList.add("load-error");
      return;
    }

    const payload = {
      title,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      link: String(fd.get("link") || "").trim(),
      notes: String(fd.get("notes") || "").trim(),
    };
    if (auth.secret) payload.secret = auth.secret;
    if (auth.sessionToken) payload.sessionToken = auth.sessionToken;

    try {
      const r = await fetch("/api/custom-events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) {
          try {
            sessionStorage.removeItem(EVENT_SESSION_STORAGE_KEY);
          } catch {
            /* ignore */
          }
        }
        status.textContent = j.error || "Could not add event.";
        status.classList.remove("muted");
        status.classList.add("load-error");
        return;
      }
      status.textContent = "Event added to the calendar.";
      status.classList.add("muted");
      form.reset();
      const listR = await fetch("/api/custom-events", { credentials: "include" });
      let list = [];
      if (listR.ok) {
        try {
          const parsed = await listR.json();
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          /* ignore */
        }
      }
      refreshEventCache(cachedCompetitions, list);
    } catch {
      status.textContent =
        "Could not reach the server. Use the site over http(s) with npm start (not opening the HTML file directly).";
      status.classList.remove("muted");
      status.classList.add("load-error");
    }
  });

  let liveMapControlsBound = false;
  let liveMapPlane = 0;
  let liveMapPlayers = [];
  let liveMapPollTimer = null;
  let lastLiveMapOnPlanePlayers = [];

  function stopLiveMapPoll() {
    if (liveMapPollTimer != null) {
      clearInterval(liveMapPollTimer);
      liveMapPollTimer = null;
    }
  }

  /** OSRS plane 0–3 (shown as Plane 1–4). Accepts z | floor | level. */
  function normalizeLiveMapPlayer(pl) {
    if (!pl || typeof pl !== "object") return null;
    let plane = pl.plane;
    if (plane == null && pl.z != null) plane = pl.z;
    if (plane == null && pl.floor != null) plane = pl.floor;
    if (plane == null && pl.level != null) plane = pl.level;
    plane = Number(plane);
    if (!Number.isFinite(plane) || plane < 0) plane = 0;
    if (plane > 3) plane = 3;
    const displayName = pl.displayName ?? pl.name ?? "?";
    const name = pl.name ?? pl.displayName ?? displayName;
    return { ...pl, plane, name, displayName };
  }

  function applyLiveMapPlayersList(arr) {
    const list = Array.isArray(arr) ? arr : [];
    liveMapPlayers = list.map(normalizeLiveMapPlayer).filter(Boolean);
  }

  /** Live map API rows: skip offline; require x/y (same rules as map markers). */
  function liveMapRowsToOnlinePlayers(rows) {
    if (!Array.isArray(rows)) return [];
    const next = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (String(row.status || "online").toLowerCase() === "offline") continue;
      const p = normalizeLiveMapPlayer({
        name: row.name,
        displayName: row.displayName ?? row.name,
        x: row.x ?? row.worldX ?? row.world_x,
        y: row.y ?? row.worldY ?? row.world_y,
        plane: row.plane ?? row.z,
        status: row.status,
        title: row.title,
        world: row.world,
      });
      if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) next.push(p);
    }
    return next;
  }

  function mergeApiPlayers(rows) {
    liveMapPlayers = liveMapRowsToOnlinePlayers(rows);
  }

  let homeLiveMapPollTimer = null;

  async function refreshHomeLiveMapPresence() {
    const statEl = document.querySelector('[data-stat="online"]');
    const onl = document.getElementById("online-members");
    try {
      const r = await fetch("/api/live-map-players", { credentials: "same-origin" });
      if (!r.ok) {
        if (statEl) statEl.textContent = "—";
        if (onl) onl.innerHTML = '<li class="muted">Live map API unavailable.</li>';
        return;
      }
      const j = await r.json();
      const players = liveMapRowsToOnlinePlayers(Array.isArray(j.data) ? j.data : []);
      if (statEl) statEl.textContent = String(players.length);
      if (onl) {
        const sorted = [...players].sort((a, b) =>
          String(a.displayName || a.name || "").localeCompare(String(b.displayName || b.name || ""), undefined, {
            sensitivity: "base",
          })
        );
        onl.innerHTML = sorted.length
          ? sorted
              .map((p) => {
                const label = escHtml(p.displayName || p.name || "?");
                const planeNum = Number.isFinite(p.plane) ? Math.min(3, Math.max(0, Number(p.plane))) + 1 : 1;
                const bits = [`Plane ${planeNum}`];
                if (p.world != null && Number.isFinite(Number(p.world))) bits.push(`W${Number(p.world)}`);
                const sub = bits.join(" · ");
                return `<li><a href="#/map" class="wom-link">${label}</a> <span class="muted">${escHtml(sub)}</span></li>`;
              })
              .join("")
          : '<li class="muted">No one on the live map. Use the RuneLite plugin to share your in-game location.</li>';
      }
    } catch {
      if (statEl) statEl.textContent = "—";
      if (onl) onl.innerHTML = '<li class="muted">Could not load live map.</li>';
    }
  }

  function startHomeLiveMapPoll() {
    if (homeLiveMapPollTimer != null) return;
    homeLiveMapPollTimer = setInterval(() => {
      const hv = document.getElementById("home-view");
      if (hv && !hv.hidden) void refreshHomeLiveMapPresence();
    }, 30000);
  }

  function syncPlaneSelect() {
    const sel = document.getElementById("map-plane-select");
    if (!sel) return;
    const want = String(liveMapPlane);
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === want) {
        sel.selectedIndex = i;
        return;
      }
    }
  }

  function renderLiveMapUi() {
    const box = document.getElementById("map-live-player-buttons");
    const hint = document.getElementById("map-live-empty-hint");
    if (!box) return;

    syncPlaneSelect();

    const onPlane = liveMapPlayers.filter((pl) => pl.plane === liveMapPlane);
    lastLiveMapOnPlanePlayers = onPlane;

    if (window.TerpinheimerOsrsMap) {
      window.TerpinheimerOsrsMap.setPlane(liveMapPlane);
      window.TerpinheimerOsrsMap.setMarkers(onPlane);
    }

    if (!onPlane.length) {
      box.innerHTML = "";
      if (hint) hint.hidden = false;
    } else {
      if (hint) hint.hidden = true;
      box.innerHTML = onPlane
        .map(
          (pl, idx) =>
            `<button type="button" class="live-map-player-btn" data-player-idx="${idx}"><span class="live-map-player-dot" aria-hidden="true"></span>${escHtml(
              pl.displayName || pl.name || "?"
            )}</button>`
        )
        .join("");
    }
  }

  function bindLiveMapControlsOnce() {
    if (liveMapControlsBound) return;
    liveMapControlsBound = true;

    const sel = document.getElementById("map-plane-select");
    if (sel) {
      sel.addEventListener("change", () => {
        const v = Number(sel.value);
        if (Number.isNaN(v)) return;
        liveMapPlane = Math.min(3, Math.max(0, v));
        renderLiveMapUi();
      });
    }

    const btnRoot = document.getElementById("map-live-player-buttons");
    if (btnRoot) {
      btnRoot.addEventListener("click", (e) => {
        const b = e.target.closest("[data-player-idx]");
        if (!b) return;
        const idx = Number(b.getAttribute("data-player-idx"));
        const pl = lastLiveMapOnPlanePlayers[idx];
        if (!pl) return;
        liveMapPlane = Math.min(3, Math.max(0, pl.plane));
        syncPlaneSelect();
        if (window.TerpinheimerOsrsMap) {
          window.TerpinheimerOsrsMap.setPlane(liveMapPlane);
          window.TerpinheimerOsrsMap.setMarkers(liveMapPlayers.filter((p) => p.plane === liveMapPlane));
          window.TerpinheimerOsrsMap.flyToGameTile(pl.x, pl.y);
        }
      });
    }

    const plugin = document.getElementById("map-plugin-link");
    if (plugin) {
      plugin.addEventListener("click", (e) => {
        if (plugin.getAttribute("href") === "#") e.preventDefault();
      });
    }
  }

  function startLiveMapPoll() {
    stopLiveMapPoll();
    liveMapPollTimer = setInterval(async () => {
      const mapv = document.getElementById("map-view");
      if (!mapv || mapv.hidden) return;
      try {
        const r = await fetch("/api/live-map-players", { credentials: "same-origin" });
        if (!r.ok) return;
        const j = await r.json();
        if (Array.isArray(j.data)) mergeApiPlayers(j.data);
        renderLiveMapUi();
      } catch {
        /* ignore */
      }
    }, 1000);
  }

  function showPluginView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (bingov) bingov.hidden = true;
    if (mapv) mapv.hidden = true;
    if (adminv) adminv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (plugv) plugv.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Plugin | Terpinheimer";
    applyDiscordInviteLinks();
  }

  function showMapView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const bingov = document.getElementById("bingo-view");
    const mapv = document.getElementById("map-view");
    const adminv = document.getElementById("admin-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (bingov) bingov.hidden = true;
    if (adminv) adminv.hidden = true;
    if (mapv) mapv.hidden = false;
    document.body.classList.add("map-route-live");
    window.scrollTo(0, 0);
    document.title = "Live Map | Terpinheimer";
    bindLiveMapControlsOnce();

    if (window.TerpinheimerOsrsMap) {
      window.TerpinheimerOsrsMap.ensureMap("map-leaflet", { plane: liveMapPlane });
      const mapInst = window.TerpinheimerOsrsMap.getMap();
      const playerBox = document.getElementById("map-player-box");
      if (mapInst && playerBox && window.L) {
        window.L.DomEvent.disableScrollPropagation(playerBox);
        window.L.DomEvent.disableClickPropagation(playerBox);
      }
    }

    renderLiveMapUi();
    if (window.TerpinheimerOsrsMap) {
      requestAnimationFrame(() => {
        window.TerpinheimerOsrsMap.invalidateSize();
      });
    }

    void (async () => {
      try {
        const r = await fetch("/api/live-map-players", { credentials: "same-origin" });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.data)) mergeApiPlayers(j.data);
        }
      } catch {
        /* keep client-injected players */
      }
      renderLiveMapUi();
    })();

    startLiveMapPoll();
  }

  window.TerpinheimerLiveMap = window.TerpinheimerLiveMap || {};
  /**
   * @param {object[]} players { x, y, plane?, name? | displayName?, ... } — OSRS game tile coords (Explv tile set).
   * @param {{ followPlane?: boolean, fitMarkers?: boolean }} [options]
   */
  window.TerpinheimerLiveMap.setPlayers = (players, options = {}) => {
    applyLiveMapPlayersList(players);
    const follow = !!options.followPlane;
    if (follow && liveMapPlayers.length > 0) {
      const counts = [0, 0, 0, 0];
      for (const pl of liveMapPlayers) counts[pl.plane]++;
      let bestPlane = 0;
      let bestCount = -1;
      for (let i = 0; i <= 3; i++) {
        if (counts[i] > bestCount) {
          bestCount = counts[i];
          bestPlane = i;
        }
      }
      liveMapPlane = bestPlane;
    }
    const mapv = document.getElementById("map-view");
    if (mapv && !mapv.hidden) {
      syncPlaneSelect();
      renderLiveMapUi();
      const shouldFit = follow && options.fitMarkers !== false;
      if (shouldFit && window.TerpinheimerOsrsMap) {
        requestAnimationFrame(() => window.TerpinheimerOsrsMap.fitToMarkersIfAny());
      }
    }
  };
  window.TerpinheimerLiveMap.setPlane = (n) => {
    liveMapPlane = Math.min(3, Math.max(0, Number(n) || 0));
    const mapv = document.getElementById("map-view");
    if (mapv && !mapv.hidden) {
      syncPlaneSelect();
      renderLiveMapUi();
    }
  };
  window.TerpinheimerLiveMap.getPlane = () => liveMapPlane;

  window.addEventListener("hashchange", applyRoute);
  attachTerpinheimerBingoApi();
  bindActivityLogSelectionOnce();
  applyRoute();

  /** Coarse pointer or narrow view: skip parallax RAF (fixes mobile scroll jank). */
  function prefersMobileScrollLite() {
    try {
      return (
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(max-width: 768px)").matches
      );
    } catch {
      return typeof window.innerWidth === "number" && window.innerWidth <= 768;
    }
  }

  if (prefersMobileScrollLite()) {
    document.documentElement.classList.add("lite-scroll");
  }

  /** Smooth scroll-linked background: eases --bg-scroll / --scroll-progress for parallax + vignette (CSS). */
  (function initScrollBackground() {
    const root = document.documentElement;
    if (root.classList.contains("lite-scroll")) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let smooth = window.scrollY || 0;
    let rafId = 0;

    function applyY(y) {
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, y / max));
      root.style.setProperty("--bg-scroll", `${y}px`);
      root.style.setProperty("--scroll-progress", String(p));
    }

    function step() {
      const target = window.scrollY || 0;
      if (reduced.matches) {
        smooth = target;
        applyY(smooth);
        rafId = 0;
        return;
      }
      smooth += (target - smooth) * 0.11;
      applyY(smooth);
      if (Math.abs(target - smooth) > 0.4) {
        rafId = requestAnimationFrame(step);
      } else {
        smooth = target;
        applyY(smooth);
        rafId = 0;
      }
    }

    function onScroll() {
      if (reduced.matches) {
        applyY(window.scrollY || 0);
        return;
      }
      if (!rafId) rafId = requestAnimationFrame(step);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    applyY(window.scrollY || 0);
  })();

  /** Home sections: fade/slide in when they enter the viewport (css/styles.css). */
  (function initHomeScrollReveal() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const els = document.querySelectorAll("#home-view .section--scroll-reveal");
    if (!els.length || reduced.matches || document.documentElement.classList.contains("lite-scroll")) return;

    const root = document.documentElement;
    root.classList.add("use-scroll-reveal");

    const mark = (el) => el.classList.add("section--scroll-reveal--visible");
    const vh = () => window.innerHeight;

    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            mark(e.target);
            obs.unobserve(e.target);
          }
        }
      },
      { root: null, rootMargin: "0px 0px -7% 0px", threshold: 0.06 }
    );

    const h = vh();
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < h * 0.94 && r.bottom > h * 0.06) {
        mark(el);
      } else {
        io.observe(el);
      }
    });
  })();

  applyDiscordInviteLinks();

  load().catch(async (e) => {
    cachedMemberships = [];
    cachedCompetitions = [];
    const membersMeta = document.getElementById("members-list-meta");
    if (membersMeta) membersMeta.textContent = "Could not load roster.";
    renderMembersListIfVisible();
    const errEl = document.getElementById("load-error");
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = womLoadErrorHint(e);
    }
    try {
      const r = await fetch("/api/custom-events", { credentials: "include" });
      const j = r.ok ? await r.json() : [];
      refreshEventCache([], Array.isArray(j) ? j : []);
    } catch {
      /* ignore */
    }
    await refreshHomeLiveMapPresence();
    startHomeLiveMapPoll();
  });
})();
