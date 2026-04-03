(function () {
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
    return `#/hiscores/${encodeURIComponent(username)}`;
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

    const skills = [...(profile.skills || [])].sort((a, b) => skillSortKey(a.name) - skillSortKey(b.name));
    let totalLvl = 0;
    const skillHtml = skills
      .map((s) => {
        const xp = s.xp || 0;
        const lv = levelFromXp(xp);
        totalLvl += lv;
        return `<div class="member-skill"><span class="member-skill-name">${escHtml(s.name)}</span><span class="member-skill-lvl">${lv}</span><span class="member-skill-xp">${fmtXp(xp)} XP</span></div>`;
      })
      .join("");
    const skEl = document.getElementById("member-skills");
    if (skEl) skEl.innerHTML = skillHtml || '<p class="muted">No skills.</p>';
    const totEl = document.getElementById("member-total-level");
    if (totEl) totEl.textContent = skills.length ? `Total level (sum of skills): ${totalLvl}` : "";

    const quests = profile.quests || [];
    const done = quests.filter((q) => q.state === 2);
    const qp = done.reduce((s, q) => s + (q.points || 0), 0);
    const qpEl = document.getElementById("member-qp");
    if (qpEl) qpEl.textContent = `${done.length} / ${quests.length} quests · ${qp} Quest points`;

    const diaries = profile.achievementDiaryTiers || [];
    const diaryRows = diaries
      .map(
        (d) =>
          `<tr><td>${escHtml(d.area)}</td><td>${escHtml(d.tierName)}</td><td>${d.completedCount}/${d.tasksCount}</td></tr>`
      )
      .join("");
    const dEl = document.getElementById("member-diaries");
    if (dEl)
      dEl.innerHTML = `<thead><tr><th>Area</th><th>Tier</th><th>Done</th></tr></thead><tbody>${diaryRows}</tbody>`;

    const ca = profile.combatAchievementTiers || [];
    const caEl = document.getElementById("member-combat");
    if (caEl)
      caEl.innerHTML = ca
        .map((t) => {
          const pct = t.tasksCount ? Math.min(100, (100 * t.completedCount) / t.tasksCount) : 0;
          return `<li>
          <div class="member-ca-label"><span>${escHtml(t.name)}</span><span>${t.completedCount}/${t.tasksCount}</span></div>
          <div class="member-ca-bar"><div class="member-ca-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </li>`;
        })
        .join("");

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
    const err = document.getElementById("member-error");
    if (err) err.hidden = true;

    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    if (hv) hv.hidden = true;
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

  function showHomeView() {
    const hv = document.getElementById("home-view");
    const mv = document.getElementById("member-view");
    if (mv) mv.hidden = true;
    if (hv) hv.hidden = false;
    document.title = "Terpinheimer | OSRS Clan";
  }

  function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyRoute() {
    const raw = window.location.hash ? window.location.hash.slice(1) : "/";
    let path = raw.startsWith("/") ? raw : `/${raw}`;
    path = path.split("?")[0].replace(/\/+$/, "") || "/";

    const segs = path.split("/").filter(Boolean);
    if (segs.length >= 2 && segs[0].toLowerCase() === "hiscores") {
      const slug = segs.slice(1).join("/");
      if (slug) {
        openMemberPage(slug);
        return;
      }
    }

    showHomeView();

    if (path === "/" || path === "") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const anchor = { "/hiscores": "hiscores", "/events": "events" }[path];
    if (anchor) scrollToId(anchor);
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

  async function load() {
    const paths = {
      group: `/groups/${WOM_GROUP_ID}`,
      gainedXp: `/groups/${WOM_GROUP_ID}/gained?metric=overall&period=month&limit=200`,
      hiscores: `/groups/${WOM_GROUP_ID}/hiscores?metric=overall&limit=15`,
      gainedClues: `/groups/${WOM_GROUP_ID}/gained?metric=clue_scrolls_all&period=month&limit=200`,
      gainedColl: `/groups/${WOM_GROUP_ID}/gained?metric=collections_logged&period=month&limit=200`,
      gainedEhb: `/groups/${WOM_GROUP_ID}/gained?metric=ehb&period=month&limit=200`,
      activity: `/groups/${WOM_GROUP_ID}/activity?limit=15`,
      achievements: `/groups/${WOM_GROUP_ID}/achievements?limit=12`,
      competitions: `/groups/${WOM_GROUP_ID}/competitions?limit=10`,
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
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent =
          results[0].status === "rejected"
            ? `Could not load Wise Old Man data (${results[0].reason?.message || "error"}). Open this site over http(s), not file://.`
            : "Could not load group.";
      }
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

    const ev = document.getElementById("event-items");
    if (ev) {
      const nowTs = Date.now();
      const rows = competitions
        .filter((c) => c.visible !== false)
        .sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))
        .slice(0, 8)
        .map((c) => {
          const end = new Date(c.endsAt).getTime();
          const label = end > nowTs ? "Live" : "Ended";
          const start = new Date(c.startsAt).toLocaleDateString();
          const endD = new Date(c.endsAt).toLocaleDateString();
          const link = `https://wiseoldman.net/competitions/${c.id}`;
          return `<li><strong><a href="${link}" target="_blank" rel="noopener" class="wom-link">${c.title}</a></strong> (${label})<br><span class="event-dates">${start} – ${endD}</span></li>`;
        });
      ev.innerHTML = rows.length ? rows.join("") : "<li>No competitions listed.</li>";
    }

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

    const mem = document.getElementById("members");
    if (mem) {
      const sorted = [...memberships].sort((a, b) =>
        (a.player?.displayName || "").localeCompare(b.player?.displayName || "", undefined, { sensitivity: "base" })
      );
      mem.innerHTML = sorted
        .map((m) => {
          const p = m.player;
          const name = p?.displayName || p?.username || "?";
          const u = p?.username ? memberProfileHref(p.username) : "#/";
          return `<li><a href="${u}">${escHtml(name)}</a></li>`;
        })
        .join("");
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

  window.addEventListener("hashchange", applyRoute);
  applyRoute();

  load().catch((e) => {
    const errEl = document.getElementById("load-error");
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = `Failed to load Wise Old Man: ${e.message}`;
    }
  });
})();
