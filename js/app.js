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

  const DIARY_TIER_ORDER = ["Easy", "Medium", "Hard", "Elite", "Master"];

  function diaryTierSortKey(tierName) {
    const i = DIARY_TIER_ORDER.indexOf(String(tierName || "").trim());
    return i === -1 ? 50 : i;
  }

  const COMBAT_TIER_ORDER = ["Easy", "Medium", "Hard", "Elite", "Master", "Grandmaster"];

  function combatTierSortKey(name) {
    const i = COMBAT_TIER_ORDER.indexOf(String(name || "").trim());
    return i === -1 ? 50 : i;
  }

  /** One diary-style region card: title, aggregate bar, tier pills. `nameField` is `tierName` or `name`. */
  function buildDiaryStyleRegionHtml(title, tierRows, nameField) {
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
        return `<span class="member-diary-tier-pill${complete ? " is-complete" : ""}">${escHtml(String(label))} ${cc}/${tc}</span>`;
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
    const urls = [`/rs-item/${key}`, `${JAGEX_ITEM_API}?item=${encodeURIComponent(key)}`];
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
      return;
    }
    actEl.innerHTML = top
      .map(({ row, display, href }) => {
        const line = formatHomeItemActivityRow(row, display, href);
        return line ? `<li>${line}</li>` : "";
      })
      .filter(Boolean)
      .join("");
    const root = document.getElementById("clan-activity");
    await hydrateOsrsItemNames(root);
  }

  let memberReqId = 0;

  async function renderRuneProfile(profile) {
    const rpPage = `https://www.runeprofile.com/${encodeURIComponent(profile.username)}`;
    document.title = `${profile.username} | Terpinheimer`;
    const crumb = document.getElementById("member-crumb-name");
    if (crumb) crumb.textContent = profile.username;
    setText("member-name", profile.username);
    const typeName = profile.accountType?.name || profile.accountType?.key || "—";
    const updated = profile.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "—";
    const meta = document.getElementById("member-meta");
    if (meta) meta.textContent = `${typeName} · Last sync ${updated}`;

    const rpA = document.getElementById("member-rp-link");
    if (rpA) rpA.href = rpPage;

    const clanP = document.getElementById("member-clan-panel");
    const clanB = document.getElementById("member-clan-body");
    if (profile.clan && profile.clan.name && clanP && clanB) {
      clanP.hidden = false;
      clanB.innerHTML = `<strong style="color:var(--cream)">${escHtml(profile.clan.name)}</strong> — ${escHtml(profile.clan.title || "Member")}`;
    } else if (clanP) clanP.hidden = true;

    const skills = [...(profile.skills || [])].sort((a, b) => skillStatsTabSortKey(a.name) - skillStatsTabSortKey(b.name));
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

    const quests = profile.quests || [];
    const done = quests.filter((q) => q.state === 2);
    const qp = done.reduce((s, q) => s + (q.points || 0), 0);
    const qpEl = document.getElementById("member-qp");
    if (qpEl) qpEl.textContent = `${done.length} / ${quests.length} quests · ${qp} Quest points`;

    const diaries = profile.achievementDiaryTiers || [];
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

    const ca = profile.combatAchievementTiers || [];
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
        caEl.innerHTML = buildDiaryStyleRegionHtml("Overall", sorted, "name");
      }
    }

    const questNamesById = buildQuestNamesById(profile.quests);
    const itemMerged = mergeItemActivitiesFromProfile(profile).slice(0, CLAN_ITEM_FEED_LIMIT);
    const rEl = document.getElementById("member-recent");
    if (rEl) {
      rEl.innerHTML = itemMerged.length
        ? itemMerged.map((r) => `<li>${formatMemberItemRow(r, { questNamesById })}</li>`).join("")
        : '<li class="muted">No recent drops or collection log entries. Sync RuneProfile from RuneLite to see items here (level-ups and quests are hidden).</li>';
    }
    const itemsSec = document.getElementById("member-items-section");
    if (itemsSec) itemsSec.hidden = true;

    const mv = document.getElementById("member-view");
    await hydrateOsrsItemNames(mv);
  }

  async function openMemberPage(slug) {
    closeMobileNav();
    const err = document.getElementById("member-error");
    if (err) err.hidden = true;

    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const mapv = document.getElementById("map-view");
    if (hv) hv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (mapv) mapv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (mv) mv.hidden = false;
    window.scrollTo(0, 0);

    const id = ++memberReqId;
    setText("member-name", "Loading…");
    setText("member-meta", "");
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
        "No RuneProfile for this name. Use the exact login name, or sync with the RuneLite RuneProfile plugin."
      );
      if (err) {
        err.hidden = false;
        err.textContent =
          "Still nothing? Serve the site with node dev-server.mjs (not file://) so /rp-api and /rs-item can proxy RuneProfile and Jagex.";
      }
      return;
    }

    await renderRuneProfile(profile);
  }

  let cachedMemberships = null;

  function showHomeView() {
    closeMobileNav();
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    const listv = document.getElementById("members-list-view");
    const evw = document.getElementById("events-view");
    const plugv = document.getElementById("plugin-view");
    const mapv = document.getElementById("map-view");
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (mapv) mapv.hidden = true;
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
    const mapv = document.getElementById("map-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (plugv) plugv.hidden = true;
    if (mapv) mapv.hidden = true;
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
    const mapv = document.getElementById("map-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
    if (mapv) mapv.hidden = true;
    document.body.classList.remove("map-route-live");
    stopLiveMapPoll();
    if (listv) listv.hidden = false;
    window.scrollTo(0, 0);
    document.title = "Members | Terpinheimer";
    renderMembersList();
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

    if (path === "/map") {
      showMapView();
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
    const mapv = document.getElementById("map-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (mapv) mapv.hidden = true;
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
    const mapv = document.getElementById("map-view");
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (plugv) plugv.hidden = true;
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
