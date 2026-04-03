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

  const WOM_GROUP_ID = 23745;
  const WOM_API = "https://api.wiseoldman.net/v2";
  const WOM_GROUP_URL = `https://wiseoldman.net/groups/${WOM_GROUP_ID}`;
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

    const recent = profile.recentActivities || [];
    const questNamesById = buildQuestNamesById(profile.quests);
    const rEl = document.getElementById("member-recent");
    if (rEl)
      rEl.innerHTML = recent.length
        ? recent.map((r) => `<li>${formatRpActivity(r, { questNamesById })}</li>`).join("")
        : '<li class="muted">No recent activities.</li>';

    const items = profile.recentItems || [];
    const iEl = document.getElementById("member-items");
    if (iEl)
      iEl.innerHTML = items.length
        ? items.map((r) => `<li>${formatRpItem(r)}</li>`).join("")
        : '<li class="muted">No recent collection log updates.</li>';

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
    if (hv) hv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
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
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
    if (evw) evw.hidden = true;
    if (hv) hv.hidden = false;
    document.title = "Terpinheimer | OSRS Clan";
  }

  function applyEventFormUnlocked(unlocked) {
    const fs = document.getElementById("event-form-fieldset");
    const panel = document.getElementById("event-unlock-panel");
    if (fs) fs.disabled = !unlocked;
    if (panel) panel.hidden = !!unlocked;
  }

  async function refreshEventUnlockState() {
    try {
      const r = await fetch("/api/event-session", { credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      applyEventFormUnlocked(!!j.unlocked);
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
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (listv) listv.hidden = true;
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
    if (hv) hv.hidden = true;
    if (mv) mv.hidden = true;
    if (evw) evw.hidden = true;
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
    const r = await fetch(`${WOM_API}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  function sumGained(rows) {
    return rows.reduce((s, row) => s + (row.data && typeof row.data.gained === "number" ? row.data.gained : 0), 0);
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

  function formatActivityRow(row) {
    const name = row.player?.displayName || row.player?.username || "?";
    const t = new Date(row.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const u = row.player?.username ? womPlayerUrl(row.player.username) : WOM_GROUP_URL;
    if (row.type === "joined")
      return `<time>${t}</time> — <a href="${u}" target="_blank" rel="noopener" class="wom-link">${name}</a> joined`;
    if (row.type === "left")
      return `<time>${t}</time> — <a href="${u}" target="_blank" rel="noopener" class="wom-link">${name}</a> left`;
    if (row.type === "role_changed")
      return `<time>${t}</time> — <a href="${u}" target="_blank" rel="noopener" class="wom-link">${name}</a> role → ${row.role || "?"}`;
    return `<time>${t}</time> — ${row.type}: ${name}`;
  }

  function setDiscordLinks(url) {
    if (!url) return;
    document.querySelectorAll("[data-discord-link]").forEach((a) => {
      a.href = url;
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
        chips += `<div class="${chipClass}" title="${escHtml(tip)}">${inner}</div>`;
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
    const customEventsPromise = fetch("/api/custom-events")
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
      gainedXp: `/groups/${WOM_GROUP_ID}/gained?metric=overall&period=month&limit=200`,
      hiscores: `/groups/${WOM_GROUP_ID}/hiscores?metric=overall&limit=15`,
      gainedClues: `/groups/${WOM_GROUP_ID}/gained?metric=clue_scrolls_all&period=month&limit=200`,
      gainedColl: `/groups/${WOM_GROUP_ID}/gained?metric=collections_logged&period=month&limit=200`,
      gainedEhb: `/groups/${WOM_GROUP_ID}/gained?metric=ehb&period=month&limit=200`,
      activity: `/groups/${WOM_GROUP_ID}/activity?limit=15`,
      achievements: `/groups/${WOM_GROUP_ID}/achievements?limit=12`,
      competitions: `/groups/${WOM_GROUP_ID}/competitions?limit=30`,
    };

    const results = await Promise.allSettled([
      womGet(paths.group),
      womGet(paths.gainedXp),
      womGet(paths.hiscores),
      womGet(paths.gainedClues),
      womGet(paths.gainedColl),
      womGet(paths.gainedEhb),
      womGet(paths.activity),
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
            ? `Could not load Wise Old Man data (${results[0].reason?.message || "error"}). Open this site over http(s), not file://.`
            : "Could not load group.";
      }
      const customEvents = await customEventsPromise;
      refreshEventCache([], customEvents);
      return;
    }

    if (errEl) errEl.hidden = true;

    const gainedXp = results[1].status === "fulfilled" ? unwrapList(results[1].value) : [];
    const hiscores = results[2].status === "fulfilled" ? unwrapList(results[2].value) : [];
    const gainedClues = results[3].status === "fulfilled" ? unwrapList(results[3].value) : [];
    const gainedColl = results[4].status === "fulfilled" ? unwrapList(results[4].value) : [];
    const gainedEhb = results[5].status === "fulfilled" ? unwrapList(results[5].value) : [];
    const activity = results[6].status === "fulfilled" ? unwrapList(results[6].value) : [];
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

    const now = Date.now();
    const active7d = memberships.filter((m) => {
      const ch = m.player?.lastChangedAt;
      return ch && now - new Date(ch).getTime() < 7 * MS_DAY;
    }).length;

    setDiscordLinks(group.socialLinks?.discord);

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
    stat("online", String(active7d));
    stat("xp", fmtCompact(sumGained(gainedXp)));
    stat("bosses", sumGained(gainedEhb).toFixed(1));
    stat("clues", String(Math.round(sumGained(gainedClues))));
    stat("collections", String(Math.round(sumGained(gainedColl))));

    const monthEl = document.getElementById("top-month");
    if (monthEl) {
      monthEl.innerHTML = gainedXp
        .slice(0, 10)
        .map((row, i) => {
          const p = row.player;
          const name = p?.displayName || p?.username || "?";
          const u = p?.username ? memberProfileHref(p.username) : "#/";
          const g = row.data?.gained ?? 0;
          return `<li><strong><a href="${u}" class="wom-link">${i + 1}. ${escHtml(name)}</a></strong> — +${fmtCompact(g)} XP</li>`;
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
      const rows = activity.map((row) => `<li>${formatActivityRow(row)}</li>`);
      act.innerHTML = rows.length ? rows.join("") : "<li>No recent roster activity.</li>";
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

    const onl = document.getElementById("online-members");
    if (onl) {
      const sorted = [...memberships]
        .filter((m) => m.player?.lastChangedAt)
        .sort((a, b) => new Date(b.player.lastChangedAt) - new Date(a.player.lastChangedAt))
        .slice(0, 18);
      onl.innerHTML = sorted
        .map((m) => {
          const p = m.player;
          const name = p.displayName || p.username;
          const u = memberProfileHref(p.username);
          const when = relTime(p.lastChangedAt);
          return `<li><a href="${u}" class="wom-link">${escHtml(name)}</a> <span class="muted">${when}</span></li>`;
        })
        .join("");
      if (!sorted.length) onl.innerHTML = "<li>No update timestamps.</li>";
    }
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
        credentials: "same-origin",
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

    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const startsRaw = String(fd.get("startsAt") || "");
    const endsRaw = String(fd.get("endsAt") || "");
    const startMs = new Date(startsRaw).getTime();
    const endMs = new Date(endsRaw).getTime();
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

    try {
      const r = await fetch("/api/custom-events", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        status.textContent = j.error || "Could not add event.";
        status.classList.remove("muted");
        status.classList.add("load-error");
        return;
      }
      status.textContent = "Event added to the calendar.";
      status.classList.add("muted");
      form.reset();
      const listR = await fetch("/api/custom-events");
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

  window.addEventListener("hashchange", applyRoute);
  applyRoute();

  /** Smooth scroll-linked background: eases --bg-scroll / --scroll-progress for parallax + vignette (CSS). */
  (function initScrollBackground() {
    const root = document.documentElement;
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
      smooth += (target - smooth) * 0.14;
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

  load().catch(async (e) => {
    cachedMemberships = [];
    cachedCompetitions = [];
    const membersMeta = document.getElementById("members-list-meta");
    if (membersMeta) membersMeta.textContent = "Could not load roster.";
    renderMembersListIfVisible();
    const errEl = document.getElementById("load-error");
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = `Failed to load Wise Old Man: ${e.message}`;
    }
    try {
      const r = await fetch("/api/custom-events");
      const j = r.ok ? await r.json() : [];
      refreshEventCache([], Array.isArray(j) ? j : []);
    } catch {
      /* ignore */
    }
  });
})();
