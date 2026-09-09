# Ruune Sync for Obsidian

Automatically sync your [Ruune](https://ruune.ai) notes — summaries, metadata, and
optionally full transcripts — into your Obsidian vault.

Unlike the built-in one-click "Send to Obsidian" flow (which pushes one note at a
time via a URL scheme), this plugin does **hands-off, multi-note background
sync** directly into your vault:

- Pulls every new/updated note since the last sync (incremental, resumable).
- Writes one Markdown file per note, with YAML frontmatter (Obsidian
  "properties").
- Puts files in a folder you choose — including date-based **daily-note**
  folders (`Journal/{{date}}`).
- Runs on a timer and on startup, or on demand.
- Re-syncs update files **in place** — no duplicates.

Free on every Ruune plan.

---

## Setup

### 1. Generate a plugin token in Ruune

In the Ruune **desktop** or **mobile** app (both work — use whichever is on the
same device as the Obsidian vault you're syncing):

**Settings → Integrations → Obsidian → Ruune plugin → Generate**

Copy the token (`ruune_obs_…`). It's shown only once.

> On Obsidian mobile, generate the token in the Ruune mobile app, copy it, then
> switch to Obsidian and paste it into this plugin's settings. On desktop, do the
> same with the Ruune desktop app.

### 2. Install the plugin

**Community store (recommended):** In Obsidian, open **Settings → Community
plugins → Browse**, search for **Ruune Sync**, install, then enable it.

**Beta / manual install:**

- **Via [BRAT](https://github.com/TfTHacker/obsidian42-brat):** add this repo
  (`Internet-of-Humans/ruune-obsidian-plugin`) as a beta plugin.
- **Manually:** download `manifest.json` and `main.js` from the
  [latest release](../../releases/latest), drop them into
  `<your-vault>/.obsidian/plugins/ruune-sync/`, then **Settings → Community
  plugins → Reload** and enable **Ruune Sync**.

### 3. Connect

Open **Settings → Ruune Sync**:

1. Paste your **Plugin token**.
2. Click **Test connection** — you should see "connection OK ✓".
3. Choose your **Folder** (see below), and optionally enable
   **Include transcript** / **Include archived notes**.
4. Pick an **Auto-sync interval**, then click **Sync now**.

---

## Folder templates

The **Folder** setting controls where notes land. It supports literal
subfolders plus date tokens resolved against each note's recording date:

| Token       | Example        |
| ----------- | -------------- |
| `{{date}}`  | `2026-09-05`   |
| `{{year}}`  | `2026`         |
| `{{month}}` | `09`           |
| `{{day}}`   | `05`           |

Examples:

- `Ruune/{{date}}` (default) → `Ruune/2026-09-05/` (daily-note style).
- `_calendar/daily/{{year}}/{{year}}-{{month}}/{{year}}-{{month}}-{{day}}/meetings`
  → `_calendar/daily/2026/2026-09/2026-09-05/meetings`.
- `Notes/{{year}}/{{month}}` → `Notes/2026/09/`.
- `Notes/{{date:YYYY/MM}}` → same as above (`{{date:FORMAT}}` uses `YYYY`/`MM`/`DD`).

Leave it empty to write to the vault root.

---

## How it works

- **Server-authoritative Markdown.** The plugin asks the Ruune `obsidian-sync`
  endpoint to build each note's Markdown (with frontmatter), so formatting is
  identical to the app's other integrations.
- **Incremental & resumable.** Sync tracks a keyset watermark
  (`updated_at`); each run only fetches notes changed since the last one and
  advances the watermark per page, so an interrupted sync resumes cleanly.
- **Dedup by note ID.** The plugin remembers `noteId → file path`. Re-syncing a
  note overwrites (or moves + overwrites, if you renamed the note or changed the
  folder) instead of creating `Title 1.md`.
- **One-way.** Ruune is the source of truth. Local edits to a synced file are
  overwritten the next time that note changes in Ruune. (Use "Reset sync state"
  to force a full re-import.)

---

## Development

```bash
npm install
npm run dev      # watch build -> main.js
npm run build    # typecheck + minified production build
```

For live iteration, symlink or copy the repo into
`<vault>/.obsidian/plugins/ruune-sync/` and use a plugin reloader (e.g. Hot
Reload) or reload Obsidian after each build.

### Layout

| File              | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `src/main.ts`     | Plugin lifecycle, commands, ribbon, auto-sync timer |
| `src/settings.ts` | Settings interface + settings tab UI                |
| `src/api.ts`      | Client for the `obsidian-sync` Edge Function        |
| `src/sync.ts`     | Incremental pull + file write/dedup engine          |
| `src/types.ts`    | Wire types shared with the server                   |

### Releasing

Releases are cut by pushing a **bare version tag** that matches
`manifest.json` (Obsidian requires an exact match — no `v` prefix):

```bash
npm version patch       # bumps package.json + manifest.json + versions.json
git push && git push --tags
```

The [release workflow](.github/workflows/release.yml) builds and attaches
`manifest.json`, `main.js`, and `versions.json` to a GitHub Release named after
the tag.

### Self-hosted / staging Ruune

By default the plugin talks to the public **`https://obsidian.ruune.ai`** domain
(a stateless Cloudflare proxy in front of the `obsidian-sync` Edge Function).
For self-hosted / staging Ruune, change **Server URL** in settings to the raw
function base, e.g. `https://<project-ref>.supabase.co/functions/v1/obsidian-sync`.

---

## Privacy

The plugin talks only to your Ruune project. The token grants **read-only**
access to your own notes for sync; revoke it anytime from the Ruune app.
