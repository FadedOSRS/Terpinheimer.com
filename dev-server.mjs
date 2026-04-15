import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

/** Load `.env` if present (no extra dependency). Does not override existing `process.env`. */
function loadDotEnv() {
  const p = path.join(__dirname, ".env");
  try {
    let raw = fs.readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
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

/** GitHub org / deploy owner for the canonical Terpinheimer site (Owner tools UI is shown only here). */
const FADED_OSRS_SITE_OWNER = "FadedOSRS";

/**
 * True when this Node process is the FadedOSRS deployment (see GET /api/site/features).
 * Checks SITE_DEPLOY_OWNER first, then GITHUB_REPOSITORY / VERCEL_GIT_REPO_OWNER.
 */
function isFadedOsrsSiteDeploy() {
  const explicit = (process.env.SITE_DEPLOY_OWNER || "").trim();
  if (explicit) return explicit.toLowerCase() === FADED_OSRS_SITE_OWNER.toLowerCase();
  const ghRepo = (process.env.GITHUB_REPOSITORY || "").trim();
  if (ghRepo.includes("/")) {
    const owner = ghRepo.split("/")[0].trim();
    if (owner) return owner.toLowerCase() === FADED_OSRS_SITE_OWNER.toLowerCase();
  }
  const vercelOwner = (process.env.VERCEL_GIT_REPO_OWNER || "").trim();
  if (vercelOwner) return vercelOwner.toLowerCase() === FADED_OSRS_SITE_OWNER.toLowerCase();
  return false;
}

/** Clan events JSON file. On hosts with an ephemeral filesystem (default Render), data is lost on restart/deploy unless you use a persistent disk or set these env vars. */
function resolveCustomEventsPath() {
  const file = process.env.CUSTOM_EVENTS_PATH?.trim();
  if (file) {
    return path.isAbsolute(file) ? file : path.join(__dirname, file);
  }
  const dir = process.env.CUSTOM_EVENTS_DIR?.trim();
  if (dir) {
    return path.join(dir, "custom-events.json");
  }
  return path.join(__dirname, "_data", "custom-events.json");
}

const CUSTOM_EVENTS_PATH = resolveCustomEventsPath();
const ADMIN_USERS_PATH = resolveAdminUsersPath();

/** Visitor feedback (FAB dialog); admin-only GET. Override with SITE_FEEDBACK_PATH or SITE_FEEDBACK_DIR. */
function resolveSiteFeedbackPath() {
  const file = process.env.SITE_FEEDBACK_PATH?.trim();
  if (file) {
    return path.isAbsolute(file) ? file : path.join(__dirname, file);
  }
  const dir = process.env.SITE_FEEDBACK_DIR?.trim();
  if (dir) {
    return path.join(dir, "site-feedback.json");
  }
  return path.join(__dirname, "_data", "site-feedback.json");
}

const SITE_FEEDBACK_PATH = resolveSiteFeedbackPath();

/** Clan join applications (public POST, Bandosian admin GET). Override with CLAN_APPLICATIONS_PATH or CLAN_APPLICATIONS_DIR. */
function resolveClanApplicationsPath() {
  const file = process.env.CLAN_APPLICATIONS_PATH?.trim();
  if (file) {
    return path.isAbsolute(file) ? file : path.join(__dirname, file);
  }
  const dir = process.env.CLAN_APPLICATIONS_DIR?.trim();
  if (dir) {
    return path.join(dir, "clan-applications.json");
  }
  return path.join(__dirname, "_data", "clan-applications.json");
}

const CLAN_APPLICATIONS_PATH = resolveClanApplicationsPath();

/** Site user accounts linked via OAuth (Discord). Override with OAUTH_USERS_PATH / OAUTH_USERS_DIR. */
function resolveOAuthUsersPath() {
  const file = process.env.OAUTH_USERS_PATH?.trim();
  if (file) {
    return path.isAbsolute(file) ? file : path.join(__dirname, file);
  }
  const dir = process.env.OAUTH_USERS_DIR?.trim();
  if (dir) {
    return path.join(dir, "oauth-users.json");
  }
  return path.join(__dirname, "_data", "oauth-users.json");
}

const OAUTH_USERS_PATH = resolveOAuthUsersPath();
const OAUTH_SESSION_COOKIE = "th_oauth";
const OAUTH_SESSION_DAYS = 30;

/** Wise Old Man group (Terpinheimer) — used to verify Bandosian rank for application inbox. */
const WOM_API_GROUP_ID = 23745;
const WOM_API_BASE = "https://api.wiseoldman.net/v2";

let womGroupMembershipsCache = { at: 0, list: null };

async function fetchWomGroupMembershipsCached() {
  const ttl = 120000;
  const now = Date.now();
  if (womGroupMembershipsCache.list && now - womGroupMembershipsCache.at < ttl) {
    return womGroupMembershipsCache.list;
  }
  try {
    const r = await fetch(`${WOM_API_BASE}/groups/${WOM_API_GROUP_ID}`, {
      headers: { Accept: "application/json", "User-Agent": "TerpinheimerSite/1.0" },
    });
    if (!r.ok) {
      womGroupMembershipsCache = { at: now, list: null };
      return null;
    }
    const j = await r.json();
    const list = Array.isArray(j.memberships) ? j.memberships : [];
    womGroupMembershipsCache = { at: now, list };
    return list;
  } catch {
    return null;
  }
}

function normalizeWomUsernameKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function womRoleForLinkedRsn(memberships, linkedRsn) {
  const want = normalizeWomUsernameKey(linkedRsn);
  if (!want) return null;
  for (const m of memberships || []) {
    const u = m?.player?.username;
    if (!u) continue;
    if (normalizeWomUsernameKey(u) !== want) continue;
    return String(m.role || "").trim().toLowerCase() || null;
  }
  return null;
}

async function linkedRsnHasWomRole(linkedRsn, roleSlug) {
  const want = String(roleSlug || "").trim().toLowerCase();
  if (!want) return false;
  const mem = await fetchWomGroupMembershipsCached();
  if (!mem) return false;
  const role = womRoleForLinkedRsn(mem, linkedRsn);
  return role === want;
}

const LIVE_MAP_SECRET = (process.env.LIVE_MAP_SECRET || "").trim();
const LIVE_MAP_TTL_MS =
  Number.isFinite(Number(process.env.LIVE_MAP_PLAYER_TTL_MS)) && Number(process.env.LIVE_MAP_PLAYER_TTL_MS) > 0
    ? Number(process.env.LIVE_MAP_PLAYER_TTL_MS)
    : 120000;
const LIVE_MAP_MAX_BODY = Math.min(Math.max(Number(process.env.LIVE_MAP_MAX_BODY) || 98304, 4096), 524288);

/** Live map: keyed roster for merge + TTL (RuneLite / HTTP clients). */
const liveMapPlayersByKey = new Map();

const MAX_BODY = 32768;
const EVENT_SESSION_COOKIE = "th_ev";
const EVENT_SESSION_DAYS = 7;
const ADMIN_SESSION_COOKIE = "th_admin";
const ADMIN_SESSION_DAYS = 14;
const scryptAsync = promisify(crypto.scrypt);

function resolveAdminUsersPath() {
  const file = process.env.ADMIN_USERS_PATH?.trim();
  if (file) return path.isAbsolute(file) ? file : path.join(__dirname, file);
  const dir = process.env.ADMIN_USERS_DIR?.trim();
  if (dir) return path.join(dir, "admin-users.json");
  return path.join(__dirname, "_data", "admin-users.json");
}

/** Normalized admin login id (lowercase); supports legacy email-shaped accounts. */
function normalizeAdminIdentifier(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidAdminEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** New accounts: 3–64 chars, letters/digits/._- only (after normalize). */
function isValidAdminUsername(s) {
  if (!s || typeof s !== "string") return false;
  if (s.length < 3 || s.length > 64) return false;
  return /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(s);
}

function isValidLoginIdentifier(s) {
  return isValidAdminEmail(s) || isValidAdminUsername(s);
}

function adminUsernameFromBody(body) {
  if (!body || typeof body !== "object") return "";
  if (body.username != null && String(body.username).trim() !== "") return normalizeAdminIdentifier(body.username);
  if (body.email != null && String(body.email).trim() !== "") return normalizeAdminIdentifier(body.email);
  return "";
}

/** Optional link to `#/members/<name>` — matches site member URLs (trim, max 32, safe chars). */
function normalizeLinkedRsnForStorage(raw) {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return undefined;
  if (t.length > 32) return undefined;
  if (!/^[A-Za-z0-9 _.'-]+$/.test(t)) return undefined;
  return t;
}

/** Case-insensitive match for member profile username vs admin linked RSN. */
function normalizePlayerNameForAdminBadgeMatch(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function handlePublicSiteAdminForPlayer(req, res, url) {
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, cors);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  const rawQ = url.searchParams.get("player");
  const raw = rawQ != null ? String(rawQ) : "";
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded.replace(/\+/g, " "));
  } catch {
    decoded = raw.trim();
  }
  const want = normalizePlayerNameForAdminBadgeMatch(decoded);
  if (!want) {
    res.writeHead(200, cors);
    res.end(JSON.stringify({ siteAdmin: false }));
    return;
  }
  const data = await readAdminsRecord();
  let siteAdmin = false;
  for (const a of data.admins) {
    if (!a.linkedRsn) continue;
    if (normalizePlayerNameForAdminBadgeMatch(a.linkedRsn) === want) {
      siteAdmin = true;
      break;
    }
  }
  res.writeHead(200, cors);
  res.end(JSON.stringify({ siteAdmin }));
}

function sanitizeAdminsRecord(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const adminsIn = Array.isArray(data.admins) ? data.admins : [];
  const admins = adminsIn
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const username = normalizeAdminIdentifier(a.username ?? a.email);
      const linkedRsn = normalizeLinkedRsnForStorage(a.linkedRsn);
      const base = {
        id: typeof a.id === "string" && a.id ? a.id : crypto.randomUUID(),
        username,
        passwordHash: typeof a.passwordHash === "string" ? a.passwordHash : "",
        createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString(),
        updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : new Date().toISOString(),
        lastLoginAt: typeof a.lastLoginAt === "string" ? a.lastLoginAt : undefined,
      };
      if (linkedRsn) base.linkedRsn = linkedRsn;
      const dUid = a.discordUserId != null ? String(a.discordUserId).trim() : "";
      if (dUid && /^\d{5,25}$/.test(dUid)) base.discordUserId = dUid;
      return base;
    })
    .filter((a) => a.username && a.passwordHash);
  return { admins };
}

/**
 * Admin account tied to Discord OAuth (optional discordUserId on admin JSON, or env — see callback).
 */
async function findAdminLinkedToDiscord(profile) {
  if (!profile || !profile.id) return null;
  const data = await readAdminsRecord();
  const byJson = data.admins.find((a) => a.discordUserId && String(a.discordUserId) === profile.id);
  if (byJson) return byJson;

  const envId = process.env.ADMIN_OAUTH_DISCORD_ID?.trim();
  const envAdminUser = normalizeAdminIdentifier(process.env.ADMIN_OAUTH_ADMIN_USERNAME || "");
  if (envId && profile.id === envId && envAdminUser) {
    const adm = data.admins.find((x) => x.username === envAdminUser);
    if (adm) return adm;
  }

  const matchDiscName = (process.env.ADMIN_OAUTH_MATCH_DISCORD_USERNAME || "").trim().toLowerCase();
  const envAdminForName = normalizeAdminIdentifier(process.env.ADMIN_OAUTH_ADMIN_USERNAME || "");
  const pUser = profile.username ? String(profile.username).trim().toLowerCase() : "";
  if (matchDiscName && envAdminForName && pUser && pUser === matchDiscName) {
    const adm = data.admins.find((x) => x.username === envAdminForName);
    if (adm) return adm;
  }

  return null;
}

async function readAdminsRecord() {
  try {
    const raw = await fs.promises.readFile(ADMIN_USERS_PATH, "utf8");
    return sanitizeAdminsRecord(JSON.parse(raw));
  } catch {
    return { admins: [] };
  }
}

async function writeAdminsRecord(data) {
  const normalized = sanitizeAdminsRecord(data);
  await fs.promises.mkdir(path.dirname(ADMIN_USERS_PATH), { recursive: true });
  await fs.promises.writeFile(ADMIN_USERS_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

function splitPasswordHash(stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return null;
  return {
    salt: parts[1],
    hashHex: parts[2],
    keyLen: Number(parts[3]),
  };
}

async function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const keyLen = 64;
  const derived = await scryptAsync(password, salt, keyLen);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}$${keyLen}`;
}

async function verifyAdminPassword(password, storedHash) {
  const parsed = splitPasswordHash(storedHash);
  if (!parsed || !Number.isFinite(parsed.keyLen) || parsed.keyLen < 16 || !/^[a-f0-9]+$/i.test(parsed.salt)) return false;
  const derived = await scryptAsync(password, parsed.salt, parsed.keyLen);
  const providedHex = Buffer.from(derived).toString("hex");
  if (providedHex.length !== parsed.hashHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "utf8"), Buffer.from(parsed.hashHex, "utf8"));
  } catch {
    return false;
  }
}

function buildAdminSessionToken(loginId, secret) {
  const exp = Date.now() + ADMIN_SESSION_DAYS * 86400000;
  const payload = `${exp}.${loginId}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyAdminSessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 3) return null;
  const exp = parts[0];
  const sig = parts[parts.length - 1];
  const loginIdRaw = parts.slice(1, -1).join(".");
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]{64}$/i.test(sig)) return null;
  if (Date.now() > Number(exp)) return null;
  const payload = `${exp}.${loginIdRaw}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  const id = normalizeAdminIdentifier(loginIdRaw);
  return id && isValidLoginIdentifier(id) ? id : null;
}

function readAdminSessionFromRequest(req) {
  const secret = process.env.ADMIN_AUTH_SECRET?.trim();
  if (!secret) return null;
  const tok = getCookieHeader(req, ADMIN_SESSION_COOKIE);
  if (!tok) return null;
  return verifyAdminSessionToken(tok, secret);
}

function getOAuthSessionSecret() {
  return process.env.OAUTH_SESSION_SECRET?.trim() || "";
}

function buildOAuthSessionToken(userId, secret) {
  const exp = Date.now() + OAUTH_SESSION_DAYS * 86400000;
  const payload = `${exp}.${userId}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyOAuthSessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 3) return null;
  const exp = parts[0];
  const sig = parts[parts.length - 1];
  const userId = parts.slice(1, -1).join(".");
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]{64}$/i.test(sig)) return null;
  if (Date.now() > Number(exp)) return null;
  const payload = `${exp}.${userId}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return null;
  }
  return userId;
}

function readOAuthSessionFromRequest(req) {
  const secret = getOAuthSessionSecret();
  if (!secret || secret.length < 16) return null;
  const tok = getCookieHeader(req, OAUTH_SESSION_COOKIE);
  if (!tok) return null;
  return verifyOAuthSessionToken(tok, secret);
}

function buildDiscordOAuthState(secret, opts = {}) {
  const afterAdmin = opts.afterAdmin === true;
  const exp = Date.now() + 600000;
  const nonce = crypto.randomBytes(24).toString("hex");
  const payload = afterAdmin ? `${exp}.${nonce}.admin` : `${exp}.${nonce}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

/** Validates OAuth `state` from Discord; `afterAdmin` means return user to admin dashboard after login. */
function parseDiscordOAuthState(state, secret) {
  if (!state || typeof state !== "string") return { valid: false, afterAdmin: false };
  let raw;
  try {
    raw = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return { valid: false, afterAdmin: false };
  }
  const parts = raw.split(".");
  let exp;
  let nonce;
  let sig;
  let afterAdmin = false;
  if (parts.length === 3) {
    [exp, nonce, sig] = parts;
  } else if (parts.length === 4) {
    const tag = parts[2];
    if (tag !== "admin") return { valid: false, afterAdmin: false };
    afterAdmin = true;
    exp = parts[0];
    nonce = parts[1];
    sig = parts[3];
  } else {
    return { valid: false, afterAdmin: false };
  }
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]{48}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(sig)) {
    return { valid: false, afterAdmin: false };
  }
  if (Date.now() > Number(exp)) return { valid: false, afterAdmin: false };
  const payload = afterAdmin ? `${exp}.${nonce}.admin` : `${exp}.${nonce}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) {
      return { valid: false, afterAdmin: false };
    }
  } catch {
    return { valid: false, afterAdmin: false };
  }
  return { valid: true, afterAdmin };
}

function publicSiteOrigin() {
  const u = process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (u) {
    try {
      return new URL(u).origin;
    } catch {
      /* fall through */
    }
  }
  return "";
}

function discordOAuthRedirectUri() {
  const explicit = process.env.DISCORD_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = publicSiteOrigin();
  if (base) return `${base}/api/oauth/discord/callback`;
  return "";
}

async function readOAuthUsersRecord() {
  try {
    const raw = await fs.promises.readFile(OAUTH_USERS_PATH, "utf8");
    const j = JSON.parse(raw);
    const users = Array.isArray(j.users) ? j.users : [];
    return { users };
  } catch {
    return { users: [] };
  }
}

async function writeOAuthUsersRecord(store) {
  await fs.promises.mkdir(path.dirname(OAUTH_USERS_PATH), { recursive: true });
  const tmp = `${OAUTH_USERS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, OAUTH_USERS_PATH);
}

/**
 * Discord `/users/@me` may encode `id` as a JSON number. `JSON.parse` loses precision for large
 * snowflakes, breaking admin linking. Read exact digits from the raw body when present.
 */
function extractDiscordUserIdFromJsonBody(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return "";
  const asString = rawText.match(/"id"\s*:\s*"(\d{5,25})"/);
  if (asString) return asString[1];
  const asNumber = rawText.match(/"id"\s*:\s*(\d{10,25})(?=\s*[,}])/);
  if (asNumber) return asNumber[1];
  return "";
}

function sanitizeOAuthDiscordProfile(j) {
  if (!j || typeof j !== "object") return null;
  const id = String(j.id ?? "").trim();
  if (!/^\d{5,25}$/.test(id)) return null;
  const username = String(j.username || "").trim().slice(0, 80);
  const globalName = j.global_name != null ? String(j.global_name).trim().slice(0, 80) : "";
  const displayName = globalName || username || "Discord user";
  const avatar = j.avatar != null ? String(j.avatar).trim() : "";
  const email = j.email != null ? String(j.email).trim().slice(0, 120) : "";
  let avatarUrl = null;
  if (avatar && /^[a-f0-9]{16,128}$/i.test(avatar)) {
    const ext = avatar.startsWith("a_") ? "gif" : "png";
    avatarUrl = `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=64`;
  }
  return { id, username, displayName, email: email || undefined, avatarUrl };
}

async function handleOAuthApi(req, res, url) {
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const oauthSecret = getOAuthSessionSecret();
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET?.trim();

  if (url.pathname === "/api/oauth/me") {
    if (req.method !== "GET") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    if (!oauthSecret || oauthSecret.length < 16) {
      res.writeHead(503, cors);
      res.end(JSON.stringify({ error: "OAuth is not configured on the server.", configured: false }));
      return;
    }
    const userId = readOAuthSessionFromRequest(req);
    if (!userId) {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ authenticated: false, configured: true }));
      return;
    }
    try {
      const data = await readOAuthUsersRecord();
      const user = data.users.find((u) => u && u.id === userId);
      if (!user) {
        const secure = cookieSecureDirective(req);
        res.writeHead(200, {
          ...cors,
          "Set-Cookie": `${OAUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
        });
        res.end(JSON.stringify({ authenticated: false, configured: true }));
        return;
      }
      const roles = Array.isArray(user.roles) ? user.roles.map((r) => String(r)) : ["member"];
      res.writeHead(200, cors);
      res.end(
        JSON.stringify({
          authenticated: true,
          configured: true,
          user: {
            id: user.id,
            provider: user.provider || "discord",
            username: user.displayName || user.username || "User",
            discordUsername: user.username || undefined,
            avatarUrl: user.avatarUrl || null,
            roles,
          },
        })
      );
    } catch {
      res.writeHead(500, cors);
      res.end(JSON.stringify({ error: "Could not read account data." }));
    }
    return;
  }

  if (url.pathname === "/api/oauth/logout") {
    if (req.method !== "POST") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const secure = cookieSecureDirective(req);
    res.writeHead(200, {
      ...cors,
      "Set-Cookie": `${OAUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/oauth/discord/login") {
    if (req.method !== "GET") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    if (!oauthSecret || oauthSecret.length < 16 || !clientId || !clientSecret) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><body><p>Discord OAuth is not configured. Set OAUTH_SESSION_SECRET (min 16 chars), DISCORD_OAUTH_CLIENT_ID, and DISCORD_OAUTH_CLIENT_SECRET.</p></body></html>"
      );
      return;
    }
    const redirectUri = discordOAuthRedirectUri();
    if (!redirectUri) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!DOCTYPE html><html><body><p>Set PUBLIC_SITE_URL (e.g. https://yoursite.com) or DISCORD_OAUTH_REDIRECT_URI for the Discord callback.</p></body></html>"
      );
      return;
    }
    const afterAdmin = url.searchParams.get("after") === "admin";
    const state = buildDiscordOAuthState(oauthSecret, { afterAdmin });
    const scope = encodeURIComponent("identify email");
    const rUri = encodeURIComponent(redirectUri);
    const loc = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${rUri}&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
    res.writeHead(302, { Location: loc });
    res.end();
    return;
  }

  if (url.pathname === "/api/oauth/discord/callback") {
    if (req.method !== "GET") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description") || "";
    const base = publicSiteOrigin() || "";
    const loginErrQs = (reason) => {
      const r = encodeURIComponent(reason || "error");
      return base ? `${base}/?oauth_discord_error=1&reason=${r}` : `/?oauth_discord_error=1&reason=${r}`;
    };
    if (err) {
      res.writeHead(302, { Location: loginErrQs(errDesc || err) });
      res.end();
      return;
    }
    if (!oauthSecret || oauthSecret.length < 16 || !clientId || !clientSecret) {
      res.writeHead(302, { Location: loginErrQs("oauth_not_configured") });
      res.end();
      return;
    }
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const parsedState = parseDiscordOAuthState(state, oauthSecret);
    if (!code || !parsedState.valid) {
      res.writeHead(302, { Location: loginErrQs("invalid_state") });
      res.end();
      return;
    }
    const redirectUri = discordOAuthRedirectUri();
    if (!redirectUri) {
      res.writeHead(302, { Location: loginErrQs("missing_redirect_uri") });
      res.end();
      return;
    }
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    let accessToken;
    try {
      const tr = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });
      const tj = await tr.json().catch(() => ({}));
      accessToken = typeof tj.access_token === "string" ? tj.access_token : "";
      if (!tr.ok || !accessToken) {
        res.writeHead(302, { Location: loginErrQs("token_exchange_failed") });
        res.end();
        return;
      }
    } catch {
      res.writeHead(302, { Location: loginErrQs("token_exchange_failed") });
      res.end();
      return;
    }
    let profile;
    try {
      const ur = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const rawUserJson = await ur.text();
      let uj = {};
      try {
        uj = JSON.parse(rawUserJson);
      } catch {
        uj = {};
      }
      const idExact = extractDiscordUserIdFromJsonBody(rawUserJson);
      if (idExact) {
        uj = { ...uj, id: idExact };
      }
      profile = sanitizeOAuthDiscordProfile(uj);
      if (!profile) {
        res.writeHead(302, { Location: loginErrQs("invalid_profile") });
        res.end();
        return;
      }
    } catch {
      res.writeHead(302, { Location: loginErrQs("profile_fetch_failed") });
      res.end();
      return;
    }
    const now = new Date().toISOString();
    let store = await readOAuthUsersRecord();
    let row = store.users.find((u) => u && u.provider === "discord" && u.providerUserId === profile.id);
    if (!row) {
      row = {
        id: crypto.randomUUID(),
        provider: "discord",
        providerUserId: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl || undefined,
        email: profile.email,
        roles: ["member"],
        createdAt: now,
        lastLoginAt: now,
      };
      store.users.push(row);
    } else {
      row.username = profile.username;
      row.displayName = profile.displayName;
      if (profile.avatarUrl) row.avatarUrl = profile.avatarUrl;
      if (profile.email) row.email = profile.email;
      row.lastLoginAt = now;
    }
    try {
      await writeOAuthUsersRecord(store);
    } catch {
      res.writeHead(302, { Location: loginErrQs("save_failed") });
      res.end();
      return;
    }
    const sessionTok = buildOAuthSessionToken(row.id, oauthSecret);
    const maxAge = OAUTH_SESSION_DAYS * 86400;
    const secure = cookieSecureDirective(req);
    const cookieLine = `${OAUTH_SESSION_COOKIE}=${encodeURIComponent(sessionTok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
    const cookies = [cookieLine];

    const adminSecret = process.env.ADMIN_AUTH_SECRET?.trim();
    const linkedAdmin = adminSecret ? await findAdminLinkedToDiscord(profile) : null;
    if (linkedAdmin && adminSecret) {
      try {
        const admData = await readAdminsRecord();
        const idx = admData.admins.findIndex((a) => a.username === linkedAdmin.username);
        if (idx >= 0) {
          admData.admins[idx].lastLoginAt = now;
          admData.admins[idx].updatedAt = now;
          await writeAdminsRecord(admData);
        }
      } catch {
        /* still set admin cookie */
      }
      const adminTok = buildAdminSessionToken(linkedAdmin.username, adminSecret);
      const adminMaxAge = ADMIN_SESSION_DAYS * 86400;
      cookies.push(
        `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(adminTok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${adminMaxAge}${secure}`
      );
    }

    const afterQs = parsedState.afterAdmin ? "&after=admin" : "";
    const successLoc = base ? `${base}/?oauth_discord=1${afterQs}` : `/?oauth_discord=1${afterQs}`;
    res.writeHead(302, {
      Location: successLoc,
      "Set-Cookie": cookies,
    });
    res.end();
    return;
  }

  res.writeHead(404, cors);
  res.end(JSON.stringify({ error: "Not found" }));
}

async function handleAdminAuthApi(req, res, url) {
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const secret = process.env.ADMIN_AUTH_SECRET?.trim();
  if (!secret) {
    res.writeHead(503, cors);
    res.end(JSON.stringify({ error: "ADMIN_AUTH_SECRET must be set." }));
    return;
  }

  if (url.pathname === "/api/admin/me") {
    if (req.method !== "GET") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const sessionId = readAdminSessionFromRequest(req);
    if (!sessionId) {
      const data0 = await readAdminsRecord();
      res.writeHead(200, cors);
      res.end(JSON.stringify({ authenticated: false, bootstrapAllowed: data0.admins.length === 0 }));
      return;
    }
    const data = await readAdminsRecord();
    const admin = data.admins.find((a) => a.username === sessionId);
    if (!admin) {
      res.writeHead(200, cors);
      res.end(JSON.stringify({ authenticated: false }));
      return;
    }
    let showApplicationInbox = false;
    if (isFadedOsrsSiteDeploy() && admin.linkedRsn) {
      showApplicationInbox = await linkedRsnHasWomRole(admin.linkedRsn, "bandosian");
    }
    res.writeHead(200, cors);
    res.end(
      JSON.stringify({
        authenticated: true,
        admin: {
          username: admin.username,
          lastLoginAt: admin.lastLoginAt,
          linkedRsn: admin.linkedRsn || null,
          showApplicationInbox,
        },
      })
    );
    return;
  }

  if (url.pathname === "/api/admin/logout") {
    if (req.method !== "POST") {
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const secure = cookieSecureDirective(req);
    const clearCookie = `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    res.writeHead(200, {
      ...cors,
      "Set-Cookie": clearCookie,
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, cors);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const read = await readRequestBody(req, 8192);
  if (read.error) {
    res.writeHead(413, cors);
    res.end(JSON.stringify({ error: "Body too large" }));
    return;
  }
  const body = parseJsonBody(read.buf);
  if (!body || typeof body !== "object") {
    res.writeHead(400, cors);
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (url.pathname === "/api/admin/link-rsn") {
    const loggedInAdmin = readAdminSessionFromRequest(req);
    if (!loggedInAdmin) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Login required." }));
      return;
    }
    const raw = body.rsn != null ? String(body.rsn) : "";
    const normalized = normalizeLinkedRsnForStorage(raw);
    if (raw.trim() && !normalized) {
      res.writeHead(400, cors);
      res.end(
        JSON.stringify({
          error:
            "Invalid RSN — use 1–32 characters: letters, numbers, spaces, hyphen, underscore, period, or apostrophe.",
        })
      );
      return;
    }
    const data = await readAdminsRecord();
    const admin = data.admins.find((a) => a.username === loggedInAdmin);
    if (!admin) {
      res.writeHead(404, cors);
      res.end(JSON.stringify({ error: "Admin record not found." }));
      return;
    }
    if (normalized) admin.linkedRsn = normalized;
    else delete admin.linkedRsn;
    admin.updatedAt = new Date().toISOString();
    await writeAdminsRecord(data);
    res.writeHead(200, cors);
    res.end(JSON.stringify({ ok: true, linkedRsn: admin.linkedRsn || null }));
    return;
  }

  if (url.pathname === "/api/admin/signup") {
    const data = await readAdminsRecord();
    const bootstrap = data.admins.length === 0;
    if (!bootstrap) {
      const loggedInAdmin = readAdminSessionFromRequest(req);
      if (!loggedInAdmin) {
        res.writeHead(401, cors);
        res.end(JSON.stringify({ error: "Login required." }));
        return;
      }
    }
    const signupKeyEnv = process.env.ADMIN_SIGNUP_KEY?.trim();
    const ownerResetKeyEnv = process.env.ADMIN_OWNER_RESET_KEY?.trim();
    const providedSignup = String(body.signupKey || "").trim();
    const providedOwner = String(body.ownerResetKey || "").trim();

    let keyAuthorized = false;
    if (bootstrap) {
      if (!signupKeyEnv || signupKeyEnv.length < 8) {
        res.writeHead(503, cors);
        res.end(JSON.stringify({ error: "ADMIN_SIGNUP_KEY must be set (min 8 characters)." }));
        return;
      }
      if (timingSafeEqualString(providedSignup, signupKeyEnv)) keyAuthorized = true;
    } else {
      let ok = false;
      if (signupKeyEnv && signupKeyEnv.length >= 8 && timingSafeEqualString(providedSignup, signupKeyEnv)) {
        ok = true;
      }
      if (
        !ok &&
        ownerResetKeyEnv &&
        ownerResetKeyEnv.length >= 10 &&
        timingSafeEqualString(providedOwner, ownerResetKeyEnv)
      ) {
        ok = true;
      }
      if (!ok) {
        res.writeHead(401, cors);
        res.end(
          JSON.stringify({
            error: "Invalid signup key or owner reset key.",
          })
        );
        return;
      }
    }

    if (bootstrap && !keyAuthorized) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Invalid signup key" }));
      return;
    }
    const username = adminUsernameFromBody(body);
    const password = String(body.password || "");
    if (!isValidAdminUsername(username)) {
      res.writeHead(400, cors);
      res.end(
        JSON.stringify({
          error:
            "Valid username is required (3–64 characters: letters, numbers, period, underscore, hyphen).",
        })
      );
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Password must be 8-128 characters." }));
      return;
    }
    if (data.admins.some((a) => a.username === username)) {
      res.writeHead(409, cors);
      res.end(JSON.stringify({ error: "Admin already exists." }));
      return;
    }
    const now = new Date().toISOString();
    const passwordHash = await hashAdminPassword(password);
    data.admins.push({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: undefined,
    });
    await writeAdminsRecord(data);
    res.writeHead(201, cors);
    res.end(JSON.stringify({ ok: true, admin: { username } }));
    return;
  }

  if (url.pathname === "/api/admin/login") {
    const loginId = adminUsernameFromBody(body);
    const password = String(body.password || "");
    if (!isValidLoginIdentifier(loginId) || !password) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Username and password are required." }));
      return;
    }
    const data = await readAdminsRecord();
    const admin = data.admins.find((a) => a.username === loginId);
    if (!admin || !(await verifyAdminPassword(password, admin.passwordHash))) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Invalid credentials" }));
      return;
    }
    admin.lastLoginAt = new Date().toISOString();
    admin.updatedAt = admin.lastLoginAt;
    await writeAdminsRecord(data);
    const token = buildAdminSessionToken(admin.username, secret);
    const maxAge = ADMIN_SESSION_DAYS * 86400;
    const secure = cookieSecureDirective(req);
    const cookieLine = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
    res.writeHead(200, {
      ...cors,
      "Set-Cookie": cookieLine,
    });
    res.end(JSON.stringify({ ok: true, admin: { username: admin.username } }));
    return;
  }

  if (url.pathname === "/api/admin/reset-password") {
    const loggedInAdmin = readAdminSessionFromRequest(req);
    if (!loggedInAdmin) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Login required." }));
      return;
    }
    const ownerResetKey = process.env.ADMIN_OWNER_RESET_KEY?.trim();
    if (!ownerResetKey || ownerResetKey.length < 10) {
      res.writeHead(503, cors);
      res.end(JSON.stringify({ error: "ADMIN_OWNER_RESET_KEY must be set (min 10 characters)." }));
      return;
    }
    const provided = String(body.ownerResetKey || "").trim();
    if (!timingSafeEqualString(provided, ownerResetKey)) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Invalid owner reset key." }));
      return;
    }
    const targetUser = adminUsernameFromBody(body);
    const newPassword = String(body.newPassword || "");
    if (!isValidLoginIdentifier(targetUser)) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Valid username is required." }));
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "New password must be 8-128 characters." }));
      return;
    }
    const data = await readAdminsRecord();
    const admin = data.admins.find((a) => a.username === targetUser);
    if (!admin) {
      res.writeHead(404, cors);
      res.end(JSON.stringify({ error: "Admin not found." }));
      return;
    }
    admin.passwordHash = await hashAdminPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    await writeAdminsRecord(data);
    res.writeHead(200, cors);
    res.end(JSON.stringify({ ok: true, username: admin.username }));
    return;
  }

  if (url.pathname === "/api/admin/delete-account") {
    const loggedInAdmin = readAdminSessionFromRequest(req);
    if (!loggedInAdmin) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Login required." }));
      return;
    }
    const ownerResetKey = process.env.ADMIN_OWNER_RESET_KEY?.trim();
    if (!ownerResetKey || ownerResetKey.length < 10) {
      res.writeHead(503, cors);
      res.end(JSON.stringify({ error: "ADMIN_OWNER_RESET_KEY must be set (min 10 characters)." }));
      return;
    }
    const provided = String(body.ownerResetKey || "").trim();
    if (!timingSafeEqualString(provided, ownerResetKey)) {
      res.writeHead(401, cors);
      res.end(JSON.stringify({ error: "Invalid owner reset key." }));
      return;
    }
    const targetUser = adminUsernameFromBody(body);
    if (!isValidLoginIdentifier(targetUser)) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Valid username is required." }));
      return;
    }
    const data = await readAdminsRecord();
    if (data.admins.length <= 1) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Cannot delete the last remaining admin." }));
      return;
    }
    if (targetUser === loggedInAdmin) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ error: "Cannot delete the currently logged-in admin account." }));
      return;
    }
    const idx = data.admins.findIndex((a) => a.username === targetUser);
    if (idx < 0) {
      res.writeHead(404, cors);
      res.end(JSON.stringify({ error: "Admin not found." }));
      return;
    }
    data.admins.splice(idx, 1);
    await writeAdminsRecord(data);
    res.writeHead(200, cors);
    res.end(JSON.stringify({ ok: true, username: targetUser }));
    return;
  }

  res.writeHead(404, cors);
  res.end(JSON.stringify({ error: "Not found" }));
}

function getCookieHeader(req, name) {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== "string") return "";
  const parts = raw.split(";").map((s) => s.trim());
  const prefix = `${name}=`;
  const hit = parts.find((x) => x.startsWith(prefix));
  if (!hit) return "";
  try {
    return decodeURIComponent(hit.slice(prefix.length));
  } catch {
    return hit.slice(prefix.length);
  }
}

function buildEventSessionToken(masterSecret) {
  const exp = Date.now() + EVENT_SESSION_DAYS * 86400000;
  const payload = String(exp);
  const sig = crypto.createHmac("sha256", masterSecret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyEventSessionToken(token, masterSecret) {
  if (!token || typeof token !== "string") return false;
  const i = token.indexOf(".");
  if (i <= 0) return false;
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac("sha256", masterSecret).update(exp).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

function cookieSecureDirective(req) {
  const x = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return x === "https" ? "; Secure" : "";
}

async function readRequestBody(req, maxLen) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxLen) return { error: "too_large" };
    chunks.push(chunk);
  }
  return { buf: Buffer.concat(chunks) };
}

async function handleEventSessionApi(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const secret = process.env.CLAN_EVENTS_SECRET;
  if (!secret || secret.length < 6) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "CLAN_EVENTS_SECRET not configured (min 6 characters)." }));
    return;
  }

  if (req.method === "GET") {
    const tok = getCookieHeader(req, EVENT_SESSION_COOKIE);
    const unlocked = verifyEventSessionToken(tok, secret);
    const adminSessionId = readAdminSessionFromRequest(req);
    const effectiveUnlocked = unlocked || !!adminSessionId;
    /** Bingo: skip the “Open designer” step when organizers use admin sign-in only (no event-session cookie). */
    const organizerViaAdmin = !!adminSessionId && !unlocked;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        unlocked: effectiveUnlocked,
        /** Same value as HttpOnly cookie — for mobile / in-app browsers that drop cookies on fetch POST. */
        sessionToken: unlocked ? tok : undefined,
        organizerViaAdmin,
      })
    );
    return;
  }

  if (req.method === "DELETE") {
    const secure = cookieSecureDirective(req);
    const clearCookie = `${EVENT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearCookie,
    });
    res.end(JSON.stringify({ ok: true, unlocked: false }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const read = await readRequestBody(req, 4096);
  if (read.error) {
    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Body too large" }));
    return;
  }

  const body = parseJsonBody(read.buf);
  const submitted = typeof body?.secret === "string" ? body.secret : "";
  if (!timingSafeEqualString(submitted, secret)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid code" }));
    return;
  }

  const token = buildEventSessionToken(secret);
  const maxAge = EVENT_SESSION_DAYS * 86400;
  const secure = cookieSecureDirective(req);
  const cookieLine = `${EVENT_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": cookieLine,
  });
  res.end(
    JSON.stringify({
      ok: true,
      unlocked: true,
      sessionToken: token,
    })
  );
}

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

function liveMapPlayerDedupeKey(p) {
  if (!p || typeof p !== "object") return null;
  const id = p.id ?? p.playerId ?? p.accountHash ?? p.uuid;
  if (id != null && String(id).length > 0) return `i:${String(id)}`;
  const n = String(p.name ?? p.displayName ?? "").trim().toLowerCase();
  if (n) return `n:${n}`;
  return null;
}

function normalizeLiveMapIncomingRow(p, now) {
  if (!p || typeof p !== "object") return null;
  const st = String(p.status ?? "online").toLowerCase();
  if (st === "offline") {
    const k = liveMapPlayerDedupeKey(p);
    return k ? { offlineKey: k } : null;
  }
  const key = liveMapPlayerDedupeKey(p);
  if (!key) return null;
  let plane = p.plane ?? p.z ?? p.floor ?? p.level ?? 0;
  plane = Number(plane);
  if (!Number.isFinite(plane) || plane < 0) plane = 0;
  if (plane > 3) plane = 3;
  const x = Number(p.x ?? p.worldX ?? p.world_x);
  const y = Number(p.y ?? p.worldY ?? p.world_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const name = String(p.name ?? p.displayName ?? "Unknown").slice(0, 64);
  const displayName = String(p.displayName ?? p.name ?? name).slice(0, 64);
  const row = {
    name,
    displayName,
    x,
    y,
    plane,
    status: String(p.status ?? "online").slice(0, 32),
  };
  if (p.title != null) row.title = String(p.title).slice(0, 128);
  if (p.id != null) row.id = p.id;
  if (p.playerId != null) row.playerId = p.playerId;
  if (p.world != null && Number.isFinite(Number(p.world))) row.world = Number(p.world);
  return { key, row, _lastSeen: now };
}

function pruneLiveMapPlayers() {
  const now = Date.now();
  for (const [k, v] of liveMapPlayersByKey) {
    if (now - v._lastSeen > LIVE_MAP_TTL_MS) liveMapPlayersByKey.delete(k);
  }
}

function liveMapPlayersSnapshot() {
  pruneLiveMapPlayers();
  return [...liveMapPlayersByKey.values()].map((v) => v.row);
}

function liveMapAuthorize(req, bodyObj) {
  if (!LIVE_MAP_SECRET) return true;
  const hk = req.headers["x-live-map-key"];
  if (typeof hk === "string" && timingSafeEqualString(hk.trim(), LIVE_MAP_SECRET)) return true;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      const t = trimmed.slice(7).trim();
      if (timingSafeEqualString(t, LIVE_MAP_SECRET)) return true;
    } else if (timingSafeEqualString(trimmed, LIVE_MAP_SECRET)) {
      return true;
    }
  }
  if (bodyObj && typeof bodyObj === "object") {
    const k = bodyObj.sharedKey ?? bodyObj.key ?? bodyObj.secret;
    if (typeof k === "string" && timingSafeEqualString(k.trim(), LIVE_MAP_SECRET)) return true;
  }
  return false;
}

/** RuneLite-style body: { name, waypoint: { x, y, plane }, title?, world? } → flat row for normalizeLiveMapIncomingRow */
function flattenRuneliteWaypointBody(j) {
  if (!j || typeof j !== "object") return null;
  const w = j.waypoint;
  if (!w || typeof w !== "object") return null;
  const x = Number(w.x);
  const y = Number(w.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let plane = w.plane ?? w.z ?? w.floor ?? w.level ?? 0;
  plane = Number(plane);
  if (!Number.isFinite(plane) || plane < 0) plane = 0;
  if (plane > 3) plane = 3;
  const name = j.name != null ? String(j.name) : "";
  const displayName = j.displayName != null ? String(j.displayName) : name || "Unknown";
  const row = {
    name: name || displayName,
    displayName,
    x,
    y,
    plane,
    status: j.status != null ? String(j.status) : "online",
  };
  if (j.title != null && String(j.title).length) row.title = String(j.title).slice(0, 128);
  if (j.world != null && Number.isFinite(Number(j.world))) row.world = Number(j.world);
  return row;
}

function liveMapExtractEntriesRemainder(j, merge) {
  if (!j || typeof j !== "object") return null;
  if (merge && j.player && typeof j.player === "object") return [j.player];
  if (merge && Number.isFinite(Number(j.x)) && Number.isFinite(Number(j.y))) {
    const { merge: _m, mode, sharedKey, key, secret, data, player, ...rest } = j;
    return [rest];
  }
  return null;
}

/** Resolves POST body to { entries, merge }. Supports RuneLite /post { waypoint }, { data }, merge modes, top-level array. */
function resolveLiveMapEntriesAndMerge(j) {
  if (j === null || j === undefined) return { entries: null, merge: false };
  if (Array.isArray(j)) return { entries: j, merge: false };
  if (typeof j !== "object") return { entries: null, merge: false };

  if (Array.isArray(j.data)) {
    const merge = j.merge === true || j.mode === "merge";
    return { entries: j.data, merge };
  }

  if (j.waypoint && typeof j.waypoint === "object") {
    const flat = flattenRuneliteWaypointBody(j);
    if (!flat) return { entries: null, merge: j.merge !== false };
    return { entries: [flat], merge: j.merge !== false };
  }

  const merge = j.merge === true || j.mode === "merge";
  const entries = liveMapExtractEntriesRemainder(j, merge);
  return { entries, merge };
}

function applyLiveMapEntries(entries) {
  const now = Date.now();
  for (const item of entries) {
    const n = normalizeLiveMapIncomingRow(item, now);
    if (!n) continue;
    if (n.offlineKey) {
      liveMapPlayersByKey.delete(n.offlineKey);
      continue;
    }
    liveMapPlayersByKey.set(n.key, { row: n.row, _lastSeen: n._lastSeen });
  }
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

async function readSiteFeedbackStore() {
  try {
    const raw = await fs.promises.readFile(SITE_FEEDBACK_PATH, "utf8");
    const j = JSON.parse(raw);
    const entries = Array.isArray(j.entries) ? j.entries : [];
    return { entries };
  } catch {
    return { entries: [] };
  }
}

async function writeSiteFeedbackStore(store) {
  await fs.promises.mkdir(path.dirname(SITE_FEEDBACK_PATH), { recursive: true });
  const tmp = `${SITE_FEEDBACK_PATH}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(store, null, 2)}\n`;
  await fs.promises.writeFile(tmp, payload, "utf8");
  await fs.promises.rename(tmp, SITE_FEEDBACK_PATH);
}

function sanitizeFeedbackMessage(raw) {
  return String(raw ?? "")
    .replace(/\u0000/g, "")
    .trim();
}

const APPLICATION_ANSWER_MAX_LEN = 4000;
const MIN_APPLICATION_ANSWER_WORDS = 5;

function wordCountApplicationAnswer(s) {
  return String(s ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Long-form application answers: trimmed, length-capped, no embedded nulls. */
function sanitizeApplicationAnswer(raw) {
  return String(raw ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, APPLICATION_ANSWER_MAX_LEN);
}

/** Calendar posting willingness: yes or no only. */
function sanitizeWillingPostCalendar(raw) {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (t === "yes" || t === "no") return t;
  return "";
}

function sanitizeFeedbackName(raw) {
  const t = String(raw ?? "").replace(/\u0000/g, "").trim().slice(0, 80);
  if (!t) return "";
  if (/[<>]/.test(t)) return "";
  return t;
}

function sanitizeFeedbackPage(raw) {
  const t = String(raw ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 500);
  if (!t) return "";
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return t.startsWith("/") || t.startsWith("#") ? t.slice(0, 500) : "";
  }
}

const FEEDBACK_STATUS_SET = new Set(["open", "in_progress", "resolved"]);

function normalizeFeedbackStatus(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s === "in-progress") return "in_progress";
  if (FEEDBACK_STATUS_SET.has(s)) return s;
  return "open";
}

function isFeedbackEntryId(id) {
  return typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id.trim());
}

/** Public POST (new message) + admin POST (update status) + admin GET for site feedback. */
async function handleSiteFeedbackApi(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET") {
    const secret = process.env.ADMIN_AUTH_SECRET?.trim();
    if (!secret) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin auth is not configured on the server." }));
      return;
    }
    const sessionId = readAdminSessionFromRequest(req);
    if (!sessionId) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin sign-in required." }));
      return;
    }
    const data = await readAdminsRecord();
    if (!data.admins.some((a) => a.username === sessionId)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin sign-in required." }));
      return;
    }
    try {
      const store = await readSiteFeedbackStore();
      const entries = (store.entries || []).map((e) =>
        e && typeof e === "object"
          ? { ...e, status: normalizeFeedbackStatus(e.status) }
          : e
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ entries }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read feedback." }));
    }
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const read = await readRequestBody(req, Math.min(MAX_BODY, 65536));
  if (read.error) {
    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Body too large." }));
    return;
  }

  const body = parseJsonBody(read.buf);
  if (!body || typeof body !== "object") {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON." }));
    return;
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (action === "updatestatus" || action === "update_status") {
    const secret = process.env.ADMIN_AUTH_SECRET?.trim();
    if (!secret) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin auth is not configured on the server." }));
      return;
    }
    const sessionId = readAdminSessionFromRequest(req);
    if (!sessionId) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin sign-in required." }));
      return;
    }
    const data = await readAdminsRecord();
    if (!data.admins.some((a) => a.username === sessionId)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Admin sign-in required." }));
      return;
    }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!isFeedbackEntryId(id)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing or invalid feedback id." }));
      return;
    }
    const status = normalizeFeedbackStatus(body.status);
    let store;
    try {
      store = await readSiteFeedbackStore();
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read feedback." }));
      return;
    }
    const idx = (store.entries || []).findIndex((e) => e && e.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Feedback not found." }));
      return;
    }
    store.entries[idx] = { ...store.entries[idx], status };
    try {
      await writeSiteFeedbackStore(store);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not save feedback." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, id, status }));
    return;
  }

  const message = sanitizeFeedbackMessage(body.message);
  if (message.length < 1 || message.length > 4000) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Message must be 1–4000 characters." }));
    return;
  }

  const nameRaw = sanitizeFeedbackName(body.name);
  const page = sanitizeFeedbackPage(body.page);

  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    message,
    name: nameRaw || undefined,
    page: page || undefined,
    status: "open",
  };

  try {
    const store = await readSiteFeedbackStore();
    store.entries.unshift(entry);
    if (store.entries.length > 500) store.entries.length = 500;
    await writeSiteFeedbackStore(store);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Could not save feedback." }));
    return;
  }

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, id: entry.id }));
}

async function readClanApplicationsStore() {
  try {
    const raw = await fs.promises.readFile(CLAN_APPLICATIONS_PATH, "utf8");
    const j = JSON.parse(raw);
    const entries = Array.isArray(j.entries) ? j.entries : [];
    return { entries };
  } catch {
    return { entries: [] };
  }
}

async function writeClanApplicationsStore(store) {
  await fs.promises.mkdir(path.dirname(CLAN_APPLICATIONS_PATH), { recursive: true });
  const tmp = `${CLAN_APPLICATIONS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, CLAN_APPLICATIONS_PATH);
}

function sanitizeApplicationDiscord(raw) {
  const t = String(raw ?? "").replace(/\u0000/g, "").trim().slice(0, 80);
  if (!t) return "";
  if (/[<>]/.test(t)) return "";
  return t;
}

async function assertBandosianApplicationViewer(req) {
  if (!isFadedOsrsSiteDeploy()) {
    return {
      ok: false,
      code: 403,
      msg: "Application inbox is only available on the main Terpinheimer deployment (FadedOSRS).",
    };
  }
  const secret = process.env.ADMIN_AUTH_SECRET?.trim();
  if (!secret) {
    return { ok: false, code: 503, msg: "Admin auth is not configured on the server." };
  }
  const sessionId = readAdminSessionFromRequest(req);
  if (!sessionId) return { ok: false, code: 401, msg: "Admin sign-in required." };
  const data = await readAdminsRecord();
  const admin = data.admins.find((a) => a.username === sessionId);
  if (!admin) return { ok: false, code: 401, msg: "Admin sign-in required." };
  if (!admin.linkedRsn || !(await linkedRsnHasWomRole(admin.linkedRsn, "bandosian"))) {
    return {
      ok: false,
      code: 403,
      msg:
        "Application inbox is only available when your linked RSN has the Bandosian clan rank on Wise Old Man.",
    };
  }
  return { ok: true, admin };
}

/** Public POST (new application) + Bandosian-admin GET + status updates. */
async function handleClanApplicationsApi(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET") {
    const gate = await assertBandosianApplicationViewer(req);
    if (!gate.ok) {
      res.writeHead(gate.code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: gate.msg }));
      return;
    }
    try {
      const store = await readClanApplicationsStore();
      const entries = (store.entries || []).map((e) =>
        e && typeof e === "object" ? { ...e, status: normalizeFeedbackStatus(e.status) } : e
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ entries }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read applications." }));
    }
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const read = await readRequestBody(req, Math.min(MAX_BODY, 65536));
  if (read.error) {
    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Body too large." }));
    return;
  }

  const body = parseJsonBody(read.buf);
  if (!body || typeof body !== "object") {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON." }));
    return;
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (action === "updatestatus" || action === "update_status") {
    const gate = await assertBandosianApplicationViewer(req);
    if (!gate.ok) {
      res.writeHead(gate.code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: gate.msg }));
      return;
    }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!isFeedbackEntryId(id)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing or invalid application id." }));
      return;
    }
    const status = normalizeFeedbackStatus(body.status);
    let store;
    try {
      store = await readClanApplicationsStore();
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read applications." }));
      return;
    }
    const idx = (store.entries || []).findIndex((e) => e && e.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Application not found." }));
      return;
    }
    store.entries[idx] = { ...store.entries[idx], status };
    try {
      await writeClanApplicationsStore(store);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not save applications." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, id, status }));
    return;
  }

  const rsn = normalizeLinkedRsnForStorage(body.rsn != null ? String(body.rsn) : "");
  if (!rsn) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error:
          "Valid RSN is required (1–32 characters: letters, numbers, spaces, hyphen, underscore, period, or apostrophe).",
      })
    );
    return;
  }

  const message = sanitizeApplicationAnswer(body.message);
  if (message.length < 1) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Tell us about yourself is required." }));
    return;
  }
  if (wordCountApplicationAnswer(message) < MIN_APPLICATION_ANSWER_WORDS) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: `Each written answer must be at least ${MIN_APPLICATION_ANSWER_WORDS} words (about yourself).`,
      })
    );
    return;
  }

  const discord = sanitizeApplicationDiscord(body.discord);
  if (!discord) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Discord username or handle is required." }));
    return;
  }

  const timezoneActivity = sanitizeApplicationAnswer(body.timezoneActivity);
  const willingPostCalendar = sanitizeWillingPostCalendar(body.willingPostCalendar);
  const eventsPerWeek = sanitizeApplicationAnswer(body.eventsPerWeek);
  const missedScheduledEvent = sanitizeApplicationAnswer(body.missedScheduledEvent);
  const whyEventHoster = sanitizeApplicationAnswer(body.whyEventHoster);
  const unfairComplaint = sanitizeApplicationAnswer(body.unfairComplaint);

  if (!willingPostCalendar) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Select Yes or No for posting events to the calendar.",
      })
    );
    return;
  }

  const essayFields = [
    { key: "timezoneActivity", label: "Timezone and activity", value: timezoneActivity },
    { key: "eventsPerWeek", label: "Events per week", value: eventsPerWeek },
    { key: "missedScheduledEvent", label: "Missing a scheduled event", value: missedScheduledEvent },
    { key: "whyEventHoster", label: "Why Event Host", value: whyEventHoster },
    { key: "unfairComplaint", label: "Unfair results complaint", value: unfairComplaint },
  ];
  for (const f of essayFields) {
    if (!f.value || wordCountApplicationAnswer(f.value) < MIN_APPLICATION_ANSWER_WORDS) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: `"${f.label}" must be at least ${MIN_APPLICATION_ANSWER_WORDS} words.`,
        })
      );
      return;
    }
  }

  const page = sanitizeFeedbackPage(body.page);

  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    rsn,
    message,
    discord,
    timezoneActivity,
    willingPostCalendar,
    eventsPerWeek,
    missedScheduledEvent,
    whyEventHoster,
    unfairComplaint,
    page: page || undefined,
    status: "open",
  };

  try {
    const store = await readClanApplicationsStore();
    store.entries.unshift(entry);
    if (store.entries.length > 500) store.entries.length = 500;
    await writeClanApplicationsStore(store);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Could not save application." }));
    return;
  }

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, id: entry.id }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DISCORD_WEBHOOK_MIN_INTERVAL_MS = Math.max(
  0,
  Number(process.env.DISCORD_WEBHOOK_MIN_INTERVAL_MS) || 2500
);
const DISCORD_WEBHOOK_MAX_RETRIES = Math.min(
  12,
  Math.max(1, Number(process.env.DISCORD_WEBHOOK_MAX_RETRIES) || 6)
);

let discordWebhookLastSent = 0;
let discordWebhookQueue = Promise.resolve();

/** Run webhook tasks one at a time (serial spacing + 429 retries). */
function enqueueDiscordWebhook(task) {
  const pending = discordWebhookQueue.then(() => task());
  discordWebhookQueue = pending.catch((err) => {
    console.warn("Discord webhook queue error:", err?.message || err);
  });
}

/** Space out POSTs and retry 429s (Discord global / per-route limits). */
async function postDiscordWebhookJson(webhook, payload) {
  const now = Date.now();
  const spacing = discordWebhookLastSent + DISCORD_WEBHOOK_MIN_INTERVAL_MS - now;
  if (spacing > 0) await sleep(spacing);

  let attempt = 0;
  while (true) {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    discordWebhookLastSent = Date.now();

    if (r.status === 429 && attempt < DISCORD_WEBHOOK_MAX_RETRIES) {
      attempt += 1;
      let delayMs = Math.min(300_000, 2500 * 2 ** (attempt - 1));
      const raHdr = r.headers.get("retry-after");
      if (raHdr) {
        const sec = Number(raHdr);
        if (Number.isFinite(sec) && sec > 0) delayMs = Math.max(delayMs, sec * 1000);
      }
      try {
        const j = JSON.parse(text);
        if (typeof j.retry_after === "number" && j.retry_after > 0) {
          delayMs = Math.max(delayMs, j.retry_after * 1000);
        }
      } catch {
        /* ignore */
      }
      console.warn(
        `Discord webhook 429 — retry ${attempt}/${DISCORD_WEBHOOK_MAX_RETRIES} in ${Math.round(delayMs / 1000)}s`
      );
      await sleep(delayMs);
      continue;
    }

    if (!r.ok) {
      console.warn("Discord webhook failed:", r.status, text.slice(0, 300));
    }
    return;
  }
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

  await postDiscordWebhookJson(webhook, payload);
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

/** Some mobile `datetime-local` values use a space instead of `T` between date and time. */
function parseClientEventInstant(s) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return NaN;
  const normalized = t.includes("T") ? t : t.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  let ms = Date.parse(normalized);
  if (Number.isNaN(ms)) ms = Date.parse(t);
  return ms;
}

function isCustomEventId(s) {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
  );
}

function authorizeCustomEventsEdit(req, secret, bodySecret, bodySessionToken) {
  if (readAdminSessionFromRequest(req)) return true;
  const cookieTok = getCookieHeader(req, EVENT_SESSION_COOKIE);
  if (verifyEventSessionToken(cookieTok, secret)) return true;
  const submitted = typeof bodySecret === "string" ? bodySecret : "";
  if (timingSafeEqualString(submitted, secret)) return true;
  const st = typeof bodySessionToken === "string" ? bodySessionToken.trim() : "";
  if (st && verifyEventSessionToken(st, secret)) return true;
  return false;
}

async function handleCustomEventsApi(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

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

  const secret = process.env.CLAN_EVENTS_SECRET;
  if (!secret || secret.length < 6) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Event submissions are not configured (set CLAN_EVENTS_SECRET on the server, min 6 characters).",
      })
    );
    return;
  }

  if (req.method === "DELETE") {
    const id = (url.searchParams.get("id") || "").trim();
    if (!isCustomEventId(id)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing or invalid id query parameter (expected event UUID)." }));
      return;
    }
    const read = await readRequestBody(req, MAX_BODY);
    if (read.error) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Body too large" }));
      return;
    }
    const body =
      read.buf.length > 0 ? parseJsonBody(read.buf) : null;
    const bodySecret =
      body && typeof body === "object" && typeof body.secret === "string" ? body.secret : "";
    if (!timingSafeEqualString(bodySecret, secret) && !readAdminSessionFromRequest(req)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: "Removing an event requires the leadership code in the JSON body (field secret). Session unlock is not enough.",
        })
      );
      return;
    }
    let list;
    try {
      list = await readCustomEvents();
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read events." }));
      return;
    }
    const next = list.filter((e) => e && e.id !== id);
    if (next.length === list.length) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Event not found." }));
      return;
    }
    try {
      await writeCustomEvents(next);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not remove event." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const read = await readRequestBody(req, MAX_BODY);
  if (read.error) {
    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Body too large" }));
    return;
  }

  const body = parseJsonBody(read.buf);
  if (!body || typeof body !== "object") {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const submitted = typeof body.secret === "string" ? body.secret : "";
  const sessionTok = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
  if (!authorizeCustomEventsEdit(req, secret, submitted, sessionTok)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Not authorized — unlock with organizer code on the Events page or send secret in JSON (e.g. bot).",
      })
    );
    return;
  }

  if (body.action === "delete") {
    if (!timingSafeEqualString(submitted, secret) && !readAdminSessionFromRequest(req)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: "Removing an event requires secret in the JSON body (same as create). Session unlock alone is not enough.",
        })
      );
      return;
    }
    const delId = typeof body.id === "string" ? body.id.trim() : "";
    if (!isCustomEventId(delId)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "delete requires a valid id (event UUID)." }));
      return;
    }
    let list;
    try {
      list = await readCustomEvents();
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not read events." }));
      return;
    }
    const next = list.filter((e) => e && e.id !== delId);
    if (next.length === list.length) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Event not found." }));
      return;
    }
    try {
      await writeCustomEvents(next);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Could not remove event." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
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
  const startMs = parseClientEventInstant(startsAt);
  const endMs = parseClientEventInstant(endsAt);
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

  enqueueDiscordWebhook(() => notifyDiscordNewClanEvent(entry));

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, event: entry }));
}

const RUNELITE_CLAN_EVENTS_SCHEMA = 1;

function runeliteClanEventsReadAuthorize(req, url) {
  const secret = process.env.RUNELITE_CLAN_EVENTS_SECRET?.trim();
  if (!secret) return true;
  const qp = String(url.searchParams.get("key") || "").trim();
  if (qp && timingSafeEqualString(qp, secret)) return true;
  const hk = req.headers["x-runelite-key"];
  if (typeof hk === "string" && timingSafeEqualString(hk.trim(), secret)) return true;
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      if (timingSafeEqualString(trimmed.slice(7).trim(), secret)) return true;
    } else if (timingSafeEqualString(trimmed, secret)) return true;
  }
  return false;
}

function normalizeClanEventForRunelite(e) {
  if (!e || typeof e !== "object") return null;
  const id = typeof e.id === "string" ? e.id.trim() : "";
  if (!isCustomEventId(id)) return null;
  const title = typeof e.title === "string" ? e.title.trim() : "";
  if (!title) return null;
  const startsAt = typeof e.startsAt === "string" ? e.startsAt.trim() : "";
  const endsAt = typeof e.endsAt === "string" ? e.endsAt.trim() : "";
  if (!startsAt || !endsAt) return null;
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) return null;
  const out = {
    id,
    title,
    startsAt,
    endsAt,
    link: typeof e.link === "string" && e.link.trim() ? e.link.trim().slice(0, 500) : null,
    notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim().slice(0, 800) : null,
  };
  if (typeof e.createdAt === "string" && e.createdAt.trim()) out.createdAt = e.createdAt.trim();
  return out;
}

/** Gson-friendly DTO: duplicate date fields + description alias (RuneLite plugins). */
function expandRuneliteEventDto(ev) {
  if (!ev) return null;
  const notes = ev.notes != null ? ev.notes : null;
  const dto = {
    id: ev.id,
    title: ev.title,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    start: ev.startsAt,
    end: ev.endsAt,
    link: ev.link,
    notes,
    description: notes,
  };
  if (ev.createdAt) dto.createdAt = ev.createdAt;
  return dto;
}

/**
 * ACTIVE = now inside [startsAt, endsAt] of some event.
 * PENDING = none active, but a future event exists.
 * NONE = no events, or all ended.
 */
function computeRuneliteCalendarSummary(events, nowMs) {
  let currentEvent = null;
  let nextEvent = null;
  let state = "NONE";
  for (const ev of events) {
    const s = Date.parse(ev.startsAt);
    const e = Date.parse(ev.endsAt);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (s <= nowMs && nowMs <= e) {
      currentEvent = ev;
      state = "ACTIVE";
      break;
    }
  }
  if (state !== "ACTIVE") {
    for (const ev of events) {
      const s = Date.parse(ev.startsAt);
      if (Number.isNaN(s)) continue;
      if (s > nowMs) {
        nextEvent = ev;
        state = "PENDING";
        break;
      }
    }
  }
  return { state, currentEvent, nextEvent };
}

async function handleRuneliteClanEventsApi(req, res, url) {
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Runelite-Key",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, cors);
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!runeliteClanEventsReadAuthorize(req, url)) {
    res.writeHead(401, cors);
    res.end(
      JSON.stringify({
        error:
          "Unauthorized — set RUNELITE_CLAN_EVENTS_SECRET on the server and pass the same value as ?key=…, header X-Runelite-Key, or Authorization (raw or Bearer).",
      })
    );
    return;
  }
  let list;
  try {
    list = await readCustomEvents();
  } catch {
    res.writeHead(500, cors);
    res.end(JSON.stringify({ error: "Could not read clan events." }));
    return;
  }
  let events = list.map(normalizeClanEventForRunelite).filter(Boolean);
  events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const now = Date.now();
  if (url.searchParams.get("upcoming") === "1") {
    events = events.filter((ev) => Date.parse(ev.endsAt) >= now);
  }
  const sinceRaw = url.searchParams.get("since");
  if (sinceRaw && String(sinceRaw).trim()) {
    const sinceMs = Date.parse(String(sinceRaw).trim());
    if (!Number.isNaN(sinceMs)) {
      events = events.filter((ev) => {
        const c = ev.createdAt ? Date.parse(ev.createdAt) : Date.parse(ev.startsAt);
        return !Number.isNaN(c) && c >= sinceMs;
      });
    }
  }

  const siteBase = process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const expanded = events.map((ev) => expandRuneliteEventDto(ev));
  const summaryCore = computeRuneliteCalendarSummary(events, now);
  const summaryDto = {
    state: summaryCore.state,
    currentEvent: expandRuneliteEventDto(summaryCore.currentEvent),
    nextEvent: expandRuneliteEventDto(summaryCore.nextEvent),
  };

  const fmt = String(url.searchParams.get("format") || "").toLowerCase();
  if (fmt === "array" || fmt === "events") {
    res.writeHead(200, cors);
    res.end(JSON.stringify(expanded));
    return;
  }

  const payload = {
    schemaVersion: RUNELITE_CLAN_EVENTS_SCHEMA,
    source: "terpinheimer",
    fetchedAt: new Date().toISOString(),
    calendarUrl: siteBase ? `${siteBase}/#/events` : null,
    eventCount: expanded.length,
    events: expanded,
    summary: summaryDto,
    state: summaryDto.state,
    summaryState: summaryDto.state,
    currentEvent: summaryDto.currentEvent,
    nextEvent: summaryDto.nextEvent,
  };
  res.writeHead(200, cors);
  res.end(JSON.stringify(payload));
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

    if (url.pathname === "/api/event-session") {
      await handleEventSessionApi(req, res);
      return;
    }

    if (url.pathname === "/api/custom-events") {
      await handleCustomEventsApi(req, res);
      return;
    }

    if (url.pathname === "/api/site-feedback") {
      await handleSiteFeedbackApi(req, res);
      return;
    }

    if (url.pathname === "/api/clan-applications") {
      await handleClanApplicationsApi(req, res);
      return;
    }

    if (url.pathname === "/api/public/site-admin-for") {
      await handlePublicSiteAdminForPlayer(req, res, url);
      return;
    }

    if (url.pathname === "/api/site/features") {
      const cors = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405, cors);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      res.writeHead(200, {
        ...cors,
        "Cache-Control": "private, max-age=60",
      });
      res.end(
        JSON.stringify({
          showAdminOwnerTools: isFadedOsrsSiteDeploy(),
          showBandosianApplicationInbox: isFadedOsrsSiteDeploy(),
        })
      );
      return;
    }

    if (
      url.pathname === "/api/oauth/me" ||
      url.pathname === "/api/oauth/logout" ||
      url.pathname === "/api/oauth/discord/login" ||
      url.pathname === "/api/oauth/discord/callback"
    ) {
      await handleOAuthApi(req, res, url);
      return;
    }

    if (
      url.pathname === "/api/admin/signup" ||
      url.pathname === "/api/admin/login" ||
      url.pathname === "/api/admin/logout" ||
      url.pathname === "/api/admin/me" ||
      url.pathname === "/api/admin/link-rsn" ||
      url.pathname === "/api/admin/reset-password" ||
      url.pathname === "/api/admin/delete-account"
    ) {
      await handleAdminAuthApi(req, res, url);
      return;
    }

    if (url.pathname === "/api/runelite/clan-events" || url.pathname === "/api/runelite/clan-calendar-summary") {
      await handleRuneliteClanEventsApi(req, res, url);
      return;
    }

    if (url.pathname === "/api/live-map-players" || url.pathname === "/post") {
      const liveMapPath = url.pathname;
      const cors = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Live-Map-Key",
      };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.method === "GET") {
        if (liveMapPath === "/post") {
          res.writeHead(404, cors);
          res.end(JSON.stringify({ error: "Use GET /api/live-map-players for the map roster." }));
          return;
        }
        res.writeHead(200, cors);
        res.end(JSON.stringify({ data: liveMapPlayersSnapshot() }));
        return;
      }
      if (req.method === "POST") {
        const read = await readRequestBody(req, LIVE_MAP_MAX_BODY);
        if (read.error) {
          res.writeHead(413, cors);
          res.end(JSON.stringify({ error: "Body too large" }));
          return;
        }
        const j = read.buf.length > 0 ? parseJsonBody(read.buf) : null;
        if (j !== null && typeof j !== "object") {
          res.writeHead(400, cors);
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        if (!liveMapAuthorize(req, j)) {
          res.writeHead(401, cors);
          res.end(
            JSON.stringify({
              error:
                "Unauthorized — set LIVE_MAP_SECRET on the server and send the same value via X-Live-Map-Key, Authorization: <secret> or Authorization: Bearer <secret>, or JSON sharedKey / key / secret.",
            })
          );
          return;
        }
        const { entries, merge } = resolveLiveMapEntriesAndMerge(j);
        if (!entries) {
          res.writeHead(400, cors);
          res.end(
            JSON.stringify({
              error:
                "Expected JSON with waypoint {x,y,plane}, or { data: [...] }, or (with merge) player / top-level x,y. See .env.example (RuneLite / live map).",
            })
          );
          return;
        }
        if (!merge) liveMapPlayersByKey.clear();
        applyLiveMapEntries(entries);
        const snapshot = liveMapPlayersSnapshot();
        res.writeHead(200, cors);
        res.end(JSON.stringify({ ok: true, count: snapshot.length, merge: !!merge }));
        return;
      }
      res.writeHead(405, cors);
      res.end(JSON.stringify({ error: "Method not allowed" }));
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

    if (url.pathname.startsWith("/api/wom/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      const suffix = url.pathname.slice("/api/wom".length);
      if (!suffix.startsWith("/v2/") || suffix.includes("..")) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid Wise Old Man path" }));
        return;
      }
      const upstream = `https://api.wiseoldman.net${suffix}${url.search}`;
      try {
        const r = await fetch(upstream, {
          headers: {
            Accept: "application/json",
            "User-Agent": "TerpinheimerSite/1.0 (group roster; contact: site owner)",
          },
        });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, {
          "Content-Type": r.headers.get("content-type") || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(buf);
      } catch {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Wise Old Man proxy failed" }));
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
    console.log(`Clan events data file: ${CUSTOM_EVENTS_PATH}`);
    console.log(`Site feedback data file: ${SITE_FEEDBACK_PATH}`);
    console.log(`Clan applications data file: ${CLAN_APPLICATIONS_PATH}`);
    console.log(`OAuth users data file: ${OAUTH_USERS_PATH}`);
    console.log(
      "Discord OAuth: GET /api/oauth/discord/login → callback → GET /api/oauth/me | POST /api/oauth/logout"
    );
    console.log("Wise Old Man API proxied at /api/wom/v2/* (same-origin; more reliable than browser → WOM)");
    console.log("RuneProfile API proxied at /rp-api/* (needed for member pages in the browser)");
    console.log("/rs-item/<id> — Jagex catalogue, then OSRSBox, then OSRS Wiki (collection log names)");
    console.log("GET /api/public/site-admin-for?player= — member profile Site Admin badge (linked RSN)");
    console.log("GET/POST/DELETE /api/event-session — browser unlock cookie; DELETE clears session");
    console.log(
      "POST /api/admin/signup | /api/admin/login | /api/admin/logout | /api/admin/link-rsn | /api/admin/reset-password | /api/admin/delete-account + GET /api/admin/me"
    );
    console.log(
      "GET/POST/DELETE /api/custom-events — calendar (POST create / POST action:delete / DELETE ?id=; cookie or JSON secret)"
    );
    console.log(
      "POST /api/site-feedback — public new message; POST { action: updateStatus, id, status } — admin; GET — admin"
    );
    console.log(
      "POST /api/clan-applications — public apply; GET + POST updateStatus — admin with Bandosian WOM rank (linked RSN)"
    );
    console.log(
      "GET /api/runelite/clan-events (alias …/clan-calendar-summary) — JSON + ACTIVE|PENDING|NONE summary; ?format=array for raw list"
    );
    console.log(
      "GET /api/live-map-players + POST /api/live-map-players or POST /post — live map (RuneLite: POST /post + waypoint JSON; optional LIVE_MAP_SECRET)"
    );
    if (process.env.DISCORD_EVENTS_WEBHOOK_URL) {
      console.log("Discord: new clan events will be posted to DISCORD_EVENTS_WEBHOOK_URL");
    }
  });
