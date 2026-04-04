# Discord: new clan events from the site

When an organizer adds an event on **Events** (`#/events`) and the server saves it, the Node server can send one message to Discord using an **Incoming Webhook**.

## 1. Create the webhook (posts to your events channel)

1. Open your Discord server → pick the **events** (or announcements) channel.
2. **Edit channel** → **Integrations** → **Webhooks** → **New Webhook**.
3. Name it (e.g. `Terpinheimer` or match your bot’s name) and optionally set an avatar.
4. **Copy Webhook URL** — it looks like  
   `https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz`

## 2. Configure the site server

Set environment variables (locally in `.env`, or on Render / your host):

| Variable | Required | Purpose |
|----------|----------|---------|
| `DISCORD_EVENTS_WEBHOOK_URL` | For Discord posts | Full webhook URL from step 1 |
| `PUBLIC_SITE_URL` | Optional | e.g. `https://yourdomain.com` — adds a link to `/#/events` in the embed |
| `DISCORD_WEBHOOK_USERNAME` | Optional | Override default display name `Terpinheimer` |
| `DISCORD_WEBHOOK_AVATAR_URL` | Optional | HTTPS image URL for the webhook avatar |

Restart `npm start` (or redeploy) after changing env vars.

If the webhook URL is missing, the site still saves events; it simply skips Discord.

## 3. How this relates to your **personal bot**

- **Webhooks are not your bot.** They use a special URL tied to one channel. Messages appear under the webhook’s name/avatar, not as your bot user.
- **To “look like the bot”:** set the webhook’s name and avatar in Discord to match your bot, or set `DISCORD_WEBHOOK_USERNAME` / `DISCORD_WEBHOOK_AVATAR_URL` to mirror it.
- **To have your bot code create events on the site:** use the same JSON body as the website form and `POST` to your live site’s `/api/custom-events` with header `Content-Type: application/json` and body including `secret` (= `CLAN_EVENTS_SECRET`), `title`, `startsAt`, `endsAt`, optional `link`, `notes`. Then either:
  - let the **webhook** announce it (if the POST goes to your deployed server that has `DISCORD_EVENTS_WEBHOOK_URL` set), or  
  - in the bot command handler, also `channel.send()` / embed yourself (you’d disable the webhook to avoid duplicate posts, or only use the bot path).

## 4. Troubleshooting

- **No message in Discord:** check server logs for `Discord webhook failed:` or `Discord notify error:`.
- **401 / 404 from Discord:** webhook was deleted or URL is wrong; create a new webhook and update the env var.
- **Embed link wrong:** set `PUBLIC_SITE_URL` to your real public origin (no trailing slash).

---

## 5. Your personal bot (`discord.js`): create events on the site

Your bot runs **separate** from the Terpinheimer site. To add a calendar event from a slash command (or any handler), **`fetch` your live site** — same as the website form.

### Env on the machine that runs the bot

| Variable | Purpose |
|----------|---------|
| `TERPINHEIMER_SITE_URL` | Public origin only, e.g. `https://terpinheimer.com` (no `/api`, no trailing slash) |
| `TERPINHEIMER_EVENTS_SECRET` | Same value as **`CLAN_EVENTS_SECRET`** on the site server (never commit this; use `.env` + `dotenv`) |

The **website** unlock flow uses an **HttpOnly cookie** after `POST /api/event-session`, so the browser does not need to send `secret` on `POST /api/custom-events` or on `DELETE /api/custom-events?id=<event-uuid>`. **Bots and scripts** should send JSON `{ "secret": "<CLAN_EVENTS_SECRET>", ... }` on `POST` (no cookie required).

**Remove an event (same auth as create):**

- **Browser (after unlock):** `DELETE /api/custom-events?id=<uuid>` with cookies (no body).
- **Bot:** `DELETE` with query `id=<uuid>` and JSON body `{ "secret": "<CLAN_EVENTS_SECRET>" }`, or `POST` with `{ "secret": "...", "action": "delete", "id": "<uuid>" }`.

### Behavior choice

- **A — Webhook announces everything:** Keep `DISCORD_EVENTS_WEBHOOK_URL` on the **site** server. When the bot `POST`s to `/api/custom-events`, the site saves the event **and** sends the webhook. Your bot command can reply with “Added” only — **do not** also `channel.send()` a full duplicate unless you want two messages.
- **B — Bot posts, no webhook:** Remove `DISCORD_EVENTS_WEBHOOK_URL` from the site. Bot `POST`s to the API, then **`interaction.reply({ embeds: [...] })`** or `channel.send()` with your own embed.

### Example: slash command → `POST /api/custom-events` (discord.js v14)

```js
// npm i discord.js dotenv
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
} from "discord.js";

const site = process.env.TERPINHEIMER_SITE_URL?.replace(/\/$/, "");
const secret = process.env.TERPINHEIMER_EVENTS_SECRET;

async function postClanEvent({ title, startsAt, endsAt, link, notes }) {
  const url = `${site}/api/custom-events`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      title,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      link: link || undefined,
      notes: notes || undefined,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.event;
}

// Register a minimal command (run once with your bot token & client id):
// new REST().setToken(process.env.DISCORD_BOT_TOKEN).put(
//   Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
//   { body: [ new SlashCommandBuilder().setName("addevent").setDescription("Add clan calendar event")... ] }
// );

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "addevent") return;
  if (!site || !secret) {
    await interaction.reply({ content: "Bot env not configured (TERPINHEIMER_*).", ephemeral: true });
    return;
  }
  const title = interaction.options.getString("title", true);
  const start = interaction.options.getString("start", true); // ISO or parseable date string
  const end = interaction.options.getString("end", true);
  try {
    await postClanEvent({
      title,
      startsAt: start,
      endsAt: end,
      link: interaction.options.getString("link") ?? undefined,
      notes: interaction.options.getString("notes") ?? undefined,
    });
    await interaction.reply({
      content: `Added **${title}** to the clan calendar.${site ? ` ${site}/#/events` : ""}`,
      ephemeral: true,
    });
  } catch (e) {
    await interaction.reply({ content: `Failed: ${e.message}`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

Adjust option types (e.g. use Discord’s date/time options if you add them). The API expects **`startsAt` / `endsAt` as ISO 8601** strings (same as the website).

### Security

- Only run this command in a **trusted channel** or restrict with **role checks** in `interactionCreate`.
- `TERPINHEIMER_EVENTS_SECRET` is as sensitive as a password — anyone with it can add events via `curl` too.
