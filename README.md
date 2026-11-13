# WTT WhatsApp bot (MVP)

A WhatsApp assistant for WTT drivers. It answers only messages that start with `/bot`, in private
chats or groups, using Gemini plus read-only queries on the WTTsystem database.

```
WhatsApp (Baileys) ─► router (/bot, rate limit) ─► resolver: phone → Mapon driver → unit → WTT truck (bil)
                                                     └► Gemini (function calling) ─► tools (read-only SQL, pinned to that truck)
```

## Setup

1. `npm install` (Node 20+)
2. Run `sql/schema.sql` on the WTT database. It creates the `wa_*` tables; its commented
   section creates the read-only `wtt_bot` MySQL user.
3. `cp .env.example .env` and fill in the keys.
4. `npm run check:mapon`: counts how many drivers have a usable phone number and an assigned
   truck in Mapon. Fix any gaps in Mapon, or add rows to `wa_phone_overrides`.
5. `npm run ask -- +4512345678 "what is my next trip?"`: tests answers from the terminal, without WhatsApp.
6. `npm start`: scan the QR code with the bot phone (WhatsApp › Linked devices › Link a device).
   The session is saved in `./auth`.

On the VPS: `pm2 start src/index.js --name wtt-bot`. The first start must be interactive to scan the QR (`pm2 logs wtt-bot`).

## Usage

| Message | Result |
|---|---|
| `/bot` or `/bot help` | help text |
| `/bot what is my next trip?` | AI answer from WTT data |
| `/bot reset` | forget the conversation so far |
| anything without `/bot` | ignored |

## Who can ask what

- **Drivers** are identified by their WhatsApp number through Mapon (`driver/list.json`), then their
  current unit (`unit/list.json?include[]=drivers`), which is matched to `delivery.bil` with the same
  plate rules as `admin/mapon_truck_check.php`. They only ever see their own truck's trips.
- **`wa_phone_overrides`** links a number to a truck by hand, or marks it as office staff
  (`is_staff = 1`). Staff can ask about any truck ("/bot next trip for ZK2367M") or any driver
  by name ("/bot where does Jan Kowalski deliver today?"). The bot looks the name up in Mapon and
  uses the truck that driver is on now; if several drivers match, it asks which one.

```sql
INSERT INTO wa_phone_overrides (phone, display_name, bil, is_staff) VALUES ('+4512345678', 'Anna (office)', NULL, 1);
```

## Groups

Add the bot's number to a group. With `ALLOWED_GROUPS` empty it answers `/bot` in every group;
for the pilot, list the test group JIDs (an unlisted group's JID is logged whenever someone writes `/bot` there).
In a group the bot answers about the asker's own truck. Phase 2 adds group → truck mapping and
automatic truck groups in `src/identity/resolver.js`.

## Admin dashboard

`/admin/whatsapp_bot/` in WTTsystem, visible only to the user `admin`:

- **Dashboard:** whether the bot is online (heartbeat every minute), the QR code when WhatsApp needs linking, usage, errors and which AI model answered.
- **Settings:** bot on/off, trigger word, allowed groups, AI models, limits, the trip fields drivers may see, extra AI instructions and reply texts. Saved in `wa_settings`; the bot reloads them every minute. An empty field means the `.env` default. API keys stay in `.env`.
- **Phone numbers:** manages `wa_phone_overrides`, including numbers that recently tried the bot without being registered.
- **Conversation log:** every question and answer, with filters.

Setup: run `admin/whatsapp_bot/schema.sql` once. It creates `wa_settings` and `wa_status`, adds `wa_logs.model` and grants the bot user access.

If WhatsApp unlinks the bot (logged out), the bot clears its session and shows a new QR code on the dashboard. No SSH needed.

## Reviewing the pilot

```sql
SELECT created_at, phone, bil, question, answer, tool_calls, latency_ms, error
FROM wa_logs ORDER BY id DESC LIMIT 50;
```

## Before going live

- Confirm the free-text trip fields shown to drivers (`TEXT_FIELDS` in `src/tools/trips.js`)
  contain nothing office-only.
- Baileys is unofficial. Use a dedicated number, and expect a risk of it being banned.
