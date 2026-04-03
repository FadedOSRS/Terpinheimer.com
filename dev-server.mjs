import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

/** Load `.env` if present (no extra dependency). Does not override existing `process.env`. */
function loadDotEnv() {
  const p = path.join(__dirname, ".env");
  try {
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}
loadDotEnv();

const CUSTOM_EVENTS_PATH = path.join(__dirname, "_data", "custom-events.json");
const MAX_BODY = 32768;

function isPrivateDataPath(urlPathname) {
  const rel = decodeURIComponent(urlPathname.split("?")[0])
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");
  return rel === "_data" || rel.startsWith("_data/");
}

function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function readCustomEvents() {
  try {
    const raw = await fs.promises.readFile(CUSTOM_EVENTS_PATH, "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function writeCustomEvents(events) {
  await fs.promises.mkdir(path.dirname(CUSTOM_EVENTS_PATH), { recursive: true });
  const tmp = `${CUSTOM_EVENTS_PATH}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(events, null, 2)}\n`;
  await fs.promises.writeFile(tmp, payload, "utf8");
  await fs.promises.rename(tmp, CUSTOM_EVENTS_PATH);
}

/** Optional: post to a channel via Discord Incoming Webhook when a clan event is created on the site. */
async function notifyDiscordNewClanEvent(entry) {
  const webhook = process.env.DISCORD_EVENTS_WEBHOOK_URL?.trim();
  if (!webhook) return;

  if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//i.test(webhook)) {
    console.warn("DISCORD_EVENTS_WEBHOOK_URL ignored (must be a https://discord.com/api/webhooks/... URL).");
    return;
  }

  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return String(iso);
    }
  };

  const siteBase = process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const calLink = siteBase ? `${siteBase}/#/events` : null;

  const fields = [
    {
      name: "Starts",
      value: fmt(entry.startsAt).slice(0, 1024),
      inline: true,
    },
    {
      name: "Ends",
      value: fmt(entry.endsAt).slice(0, 1024),
      inline: true,
    },
  ];
  if (entry.link) fields.push({ name: "Link", value: String(entry.link).slice(0, 1024), inline: false });
  if (entry.notes) fields.push({ name: "Notes", value: String(entry.notes).slice(0, 1024), inline: false });

  let description = "A new event was added on the Terpinheimer site.";
  if (calLink) description += `\n\n[Open clan calendar](${calLink})`;

  const embed = {
    title: String(entry.title).slice(0, 256),
    url: calLink || undefined,
    description: description.slice(0, 4096),
    color: 0xff9f1c,
    fields,
    footer: { text: "Terpinheimer · clan calendar" },
    timestamp: entry.startsAt,
  };

  const payload = {
    username: process.env.DISCORD_WEBHOOK_USERNAME?.trim() || "Terpinheimer",
    embeds: [embed],
  };
  const avatar = process.env.DISCORD_WEBHOOK_AVATAR_URL?.trim();
  if (avatar && /^https:\/\//i.test(avatar)) payload.avatar_url = avatar;

  const r = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    console.warn("Discord webhook failed:", r.status, t.slice(0, 300));
  }
}

function parseJsonBody(buf) {
  try {
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return null;
  }
}

function isHttpsUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function handleCustomEventsApi(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET") {
    const list = await readCustomEvents();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(list));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const secret = process.env.CLAN_EVENTS_SECRET;
  if (!secret || secret.length < 12) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Event submissions are not configured (set CLAN_EVENTS_SECRET on the server).",
      })
    );
    return;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Body too large" }));
      return;
    }
    chunks.push(chunk);
  }

  const body = parseJsonBody(Buffer.concat(chunks));
  if (!body || typeof body !== "object") {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const submitted = typeof body.secret === "string" ? body.secret : "";
  if (!timingSafeEqualString(submitted, secret)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid code" }));
    return;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 180) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Title must be 1–180 characters." }));
    return;
  }

  const startsAt = typeof body.startsAt === "string" ? body.startsAt.trim() : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt.trim() : "";
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid start or end date." }));
    return;
  }
  if (endMs < startMs) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "End must be on or after start." }));
    return;
  }

  let link = "";
  if (body.link != null && String(body.link).trim()) {
    link = String(body.link).trim();
    if (link.length > 500 || !isHttpsUrl(link)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Link must be a valid http(s) URL (max 500 chars)." }));
      return;
    }
  }

  let notes = "";
  if (body.notes != null && String(body.notes).trim()) {
    notes = String(body.notes).trim().slice(0, 800);
  }

  const entry = {
    id: crypto.randomUUID(),
    title,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    link: link || undefined,
    notes: notes || undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    const list = await readCustomEvents();
    list.push(entry);
    await writeCustomEvents(list);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Could not save event." }));
    return;
  }

  void notifyDiscordNewClanEvent(entry).catch((err) => {
    console.warn("Discord notify error:", err?.message || err);
  });

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, event: entry }));
}
const WIKI_UA = "TerpinheimerLocalDev/1.0 (item name lookup; contact: local)";
const itemDetailCache = new Map();
const itemDetailInflight = new Map();

function jagexShape(name) {
  return { item: { name } };
}

function skipWikiTitle(title) {
  if (!title) return true;
  const t = title.toLowerCase();
  return t === "item ids" || t === "npc ids" || t.startsWith("list of sound ids");
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json,*/*", "User-Agent": WIKI_UA } });
  if (!r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}

async function resolveNameFromOsrsbox(id) {
  const url = `https://raw.githubusercontent.com/osrsbox/osrsbox-db/master/docs/items-json/${id}.json`;
  const j = await fetchJson(url);
  const name = j && typeof j.name === "string" ? j.name.trim() : "";
  return name || null;
}

async function fetchWikiParseHtml(page) {
  const api =
    "https://oldschool.runescape.wiki/api.php?action=parse&format=json&prop=text&disablelimitreport=1&page=" +
    encodeURIComponent(page);
  const r = await fetch(api, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
  if (!r.ok) return "";
  try {
    const j = await r.json();
    return j.parse?.text?.["*"] || "";
  } catch {
    return "";
  }
}

function wikiHtmlDeclaresItemId(html, id) {
  const needle = String(id);
  const re = /Item ID<\/th><td[^>]*>(\d+)<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === needle) return true;
  }
  return false;
}

async function resolveNameFromWiki(id) {
  const searchUrl =
    "https://oldschool.runescape.wiki/api.php?action=query&format=json&list=search&srnamespace=0&srlimit=8&srsearch=" +
    encodeURIComponent(`Item ID ${id}`);
  const r = await fetch(searchUrl, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
  if (!r.ok) return null;
  let j;
  try {
    j = await r.json();
  } catch {
    return null;
  }
  const hits = j.query?.search || [];
  for (const hit of hits) {
    const title = hit.title;
    if (skipWikiTitle(title)) continue;
    const html = await fetchWikiParseHtml(title);
    if (wikiHtmlDeclaresItemId(html, id)) return title;
  }
  return null;
}

async function resolveItemDetail(id) {
  const cached = itemDetailCache.get(id);
  if (cached) return cached;

  let pending = itemDetailInflight.get(id);
  if (pending) return pending;

  pending = (async () => {
    const upstream = `https://secure.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json?item=${id}`;
    try {
      const r = await fetch(upstream, { headers: { Accept: "application/json", "User-Agent": WIKI_UA } });
      const buf = Buffer.from(await r.arrayBuffer());
      const txt = buf.toString("utf8").trim();
      if (r.ok && txt.startsWith("{")) {
        try {
          const j = JSON.parse(txt);
          if (j.item?.name) {
            itemDetailCache.set(id, { status: 200, body: buf, contentType: "application/json; charset=utf-8" });
            return itemDetailCache.get(id);
          }
        } catch {
          /* fall through */
        }
      }
    } catch {
      /* fall through */
    }

    const osrs = await resolveNameFromOsrsbox(id);
    if (osrs) {
      const body = Buffer.from(JSON.stringify(jagexShape(osrs)), "utf8");
      itemDetailCache.set(id, { status: 200, body, contentType: "application/json; charset=utf-8" });
      return itemDetailCache.get(id);
    }

    const wiki = await resolveNameFromWiki(id);
    if (wiki) {
      const body = Buffer.from(JSON.stringify(jagexShape(wiki)), "utf8");
      itemDetailCache.set(id, { status: 200, body, contentType: "application/json; charset=utf-8" });
      return itemDetailCache.get(id);
    }

    const fail = Buffer.from(JSON.stringify({ item: null }), "utf8");
    itemDetailCache.set(id, { status: 404, body: fail, contentType: "application/json; charset=utf-8" });
    return itemDetailCache.get(id);
  })();

  itemDetailInflight.set(id, pending);
  try {
    return await pending;
  } finally {
    itemDetailInflight.delete(id);
  }
}
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const rel = path.normalize(decoded).replace(/^[/\\]+/, "");
  if (rel.includes("..")) return null;
  return path.join(root, rel);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

    if (url.pathname === "/api/custom-events") {
      await handleCustomEventsApi(req, res);
      return;
    }

    if (isPrivateDataPath(url.pathname)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const rsItem = url.pathname.match(/^\/rs-item\/(\d+)$/);
    if (rsItem) {
      try {
        const id = rsItem[1];
        const out = await resolveItemDetail(id);
        res.writeHead(out.status, {
          "Content-Type": out.contentType,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(out.body);
      } catch {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "rs-item proxy failed" }));
      }
      return;
    }

    if (url.pathname.startsWith("/rp-api/")) {
      const targetPath = url.pathname.slice("/rp-api".length) + url.search;
      const upstream = `https://api.runeprofile.com${targetPath}`;
      try {
        const r = await fetch(upstream, { headers: { Accept: "application/json" } });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, {
          "Content-Type": r.headers.get("content-type") || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(buf);
      } catch {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("RuneProfile proxy error");
      }
      return;
    }

    let filePath =
      url.pathname === "/" ? path.join(__dirname, "index.html") : safeJoin(__dirname, url.pathname);
    if (!filePath) {
      res.writeHead(403).end();
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Terpinheimer site: http://localhost:${PORT}`);
    console.log("RuneProfile API proxied at /rp-api/* (needed for member pages in the browser)");
    console.log("/rs-item/<id> — Jagex catalogue, then OSRSBox, then OSRS Wiki (collection log names)");
    console.log(
      "GET/POST /api/custom-events — clan calendar (POST needs CLAN_EVENTS_SECRET in .env or environment)"
    );
    if (process.env.DISCORD_EVENTS_WEBHOOK_URL) {
      console.log("Discord: new clan events will be posted to DISCORD_EVENTS_WEBHOOK_URL");
    }
  });
