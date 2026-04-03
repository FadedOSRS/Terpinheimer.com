import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
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
  });
