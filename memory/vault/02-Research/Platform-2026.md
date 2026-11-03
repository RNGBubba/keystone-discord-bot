# Platform research — late 2026

> The older [[Platform-Limits]] page still holds the long table. This page records
> what changed and what it means for the mission. Claims live in [[Claims]].

## The three changes that shape the plan

### 1. Privileged intents moved to 10,000 users

In June 2026 Discord replaced the old "100 servers" gate with **10,000 unique
users**, an application, a 90-day window and **annual reapplication**. App
verification and intent review are separate. There is no growth freeze while a
review is pending, but access can be removed if the window is missed.

**Consequence:** the core must run on `Guilds` alone. Welcome, join gates,
role persistence, the message scanner and full transcript text become optional
features with named fallbacks. See [[ADR-0012-required-and-optional-intents]] and
[[Intent-Review]].

### 2. Channel obfuscation lands 2026-11-16

Hidden channels disappear from `GET /guilds/{id}/channels`; gateway payloads keep
id, type, position and parent, but the name becomes `___hidden___` and the
`CHANNEL_OBFUSCATED` flag (`1 << 17`) is set. A bot that mirrors channels, matches
by name or assumes `guild.channels.cache` is complete breaks silently.

**Consequence:** every lookup goes through `resolveChannel()`; identity is always
the id. A hidden channel is a typed, non-fatal outcome. This shipped in P4.5.

### 3. Components V2 is the layout system, with hard budgets

- Flag `1 << 15`; irreversible once sent.
- `content`, `embeds`, `poll` and stickers stop working; attachments need a File
  or Media Gallery component to be visible.
- **40 components per message**, nested included.
- Roughly **4,000 combined text characters** across text-bearing components.
- Deferred responses can only be ephemeral; to send V2 you defer, then **edit**
  the original response.
- Modals now use Label wrappers; Action Row + Text Input is deprecated.
- New modal components: File Upload, Radio Group, Checkbox Group, Checkbox.

**Consequence:** `packages/ui` (pass 58) is a layout budgeter, not an
embed-string builder. No V2 panel ships unless it passes that budgeter. See
[[Command-Budget]].

## The limits we still design around

| Limit | Value | Design consequence |
| --- | --- | --- |
| Global commands | 100 chat-input, 15 user, 15 message, 1 entry point | Hubs, not one root per feature |
| Command payload | 8,000 chars including localisations | Budgeter counts localisations |
| Options | 25 per command, one nesting level | Groups only, never groups inside groups |
| AutoMod | 6 keyword + 10 regex rules; 260-char Rust regex | Richer rules stay in our scanner |
| Timeout | 28 days | No "permanent mute" promise |
| Bulk ban | 200 users | Worker-driven, audited |
| Sharding | 2,500 guilds/shard; shard at 2,500 | `shard` param on `/users/@me/guilds` |
| HTTP | 50 req/s global; 10,000 invalid/10 min | Permission precheck before every call |
| Interaction ack | 3 s; 15 min token | Defer, then edit; never inline an LLM |
| Gateway send | 120 events/60 s; 4,096 bytes | Bulk work in the worker |
| Upload | 20 MiB default | Ticket/transcript caps |

## Monetization and Activities

- If an app is monetized anywhere, Discord's **Premium Apps** rules require an
  equivalent in-Discord purchase at a price no higher than the other channel
  (effective 2024-10-07). Keystone v1.0 has no paid tier, so this is a constraint
  on any future hosted offering, not a launch feature.
- An Activity is a web app on the **same application**, with the `EMBEDDED`
  flag, URL mappings and the single `PRIMARY_ENTRY_POINT` command. Eligibility is
  a Portal gate we have not verified. It is a P8 spike, not a promise.

## What is still unverified

- The exact current top-level modal cap after the Label change.
- The 4,000-character aggregate text budget (community mirror, not an official
  sentence we read).
- Whether multiple simultaneous subscription SKUs and annual cadence are live.
- Activities eligibility criteria in the current Portal.
- The AutoMod "6 rule creates per 5 minutes" limit, which was not on the resource
  page we read.
