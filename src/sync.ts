import { normalizePath, Notice, TFile, Vault } from "obsidian";
import type RuuneSyncPlugin from "./main";
import { RuuneApi } from "./api";
import type { ExportResult, NoteSummary } from "./types";

export type SyncTrigger = "manual" | "startup" | "interval";

export interface SyncOutcome {
  imported: number;
  failed: number;
  upToDate: boolean;
}

/**
 * Pull-only sync engine.
 *
 *  1. List notes incrementally from the keyset watermark (`updated_since`).
 *  2. For each page, ask the server to build markdown (with frontmatter) and
 *     resolve the folder from our template.
 *  3. Write/overwrite one file per note, keyed by noteId in `fileIndex` so
 *     re-synced notes update in place instead of duplicating.
 *  4. Advance the watermark to `meta.next_updated_since` and persist.
 *
 * Ruune is the source of truth; local edits to synced files are overwritten on
 * the next sync of that note.
 */
export class SyncEngine {
  private running = false;

  constructor(private plugin: RuuneSyncPlugin) {}

  get isRunning(): boolean {
    return this.running;
  }

  async run(trigger: SyncTrigger): Promise<SyncOutcome | null> {
    const s = this.plugin.settings;
    if (this.running) {
      if (trigger === "manual") new Notice("Ruune: a sync is already running.");
      return null;
    }
    if (!s.token) {
      if (trigger === "manual") new Notice("Ruune: add your plugin token in settings.");
      return null;
    }

    this.running = true;
    this.plugin.setStatus("Ruune: syncing…");
    const api = new RuuneApi(s.baseUrl, s.token);

    let imported = 0;
    let failed = 0;
    let cursor = s.lastSyncCursor;

    try {
      // Page through everything newer than the watermark.
      for (;;) {
        const page = await api.listNotes({
          updatedSince: cursor,
          perPage: 100,
          archived: s.includeArchived ? "all" : null,
        });

        const notes = page.data ?? [];
        if (notes.length === 0) break;

        const res = await this.importBatch(api, notes);
        imported += res.imported;
        failed += res.failed;

        // Advance & persist the watermark after each page so an interrupted
        // sync resumes instead of restarting.
        const next = page.meta?.next_updated_since ?? null;
        if (!next || next === cursor) break;
        cursor = next;
        s.lastSyncCursor = cursor;
        await this.plugin.saveSettings();

        if (notes.length < 100) break; // last (partial) page
      }

      s.lastSyncAt = new Date().toISOString();
      await this.plugin.saveSettings();

      const upToDate = imported === 0 && failed === 0;
      if (trigger === "manual" || imported > 0 || failed > 0) {
        new Notice(this.summaryMessage(imported, failed, upToDate));
      }
      this.plugin.setStatus(
        imported > 0 ? `Ruune: synced ${imported}` : "Ruune: up to date",
      );
      return { imported, failed, upToDate };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Ruune: sync failed — ${msg}`);
      this.plugin.setStatus("Ruune: sync failed");
      return { imported, failed, upToDate: false };
    } finally {
      this.running = false;
    }
  }

  /** Fetch markdown for a page of notes and write each to disk. */
  private async importBatch(
    api: RuuneApi,
    notes: NoteSummary[],
  ): Promise<{ imported: number; failed: number }> {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const built = await api.exportNotes({
      noteIds: notes.map((n) => n.id),
      includeTranscript: this.plugin.settings.includeTranscript,
      folderTemplate: this.plugin.settings.folderTemplate || null,
    });

    let imported = 0;
    let failed = 0;
    for (const result of built.results ?? []) {
      if (result.status !== "success" || typeof result.markdown !== "string") {
        failed++;
        continue;
      }
      try {
        await this.writeNote(result, byId.get(result.noteId));
        imported++;
      } catch (err) {
        console.error("[ruune-sync] write failed", result.noteId, err);
        failed++;
      }
    }
    return { imported, failed };
  }

  /** Write (or overwrite) a single note's file, tracking its path by noteId. */
  private async writeNote(
    result: ExportResult,
    summary: NoteSummary | undefined,
  ): Promise<void> {
    const vault = this.plugin.app.vault;

    // Prefer the server-resolved folder; else resolve our template locally.
    const folder =
      result.folder ??
      resolveFolderTemplate(
        this.plugin.settings.folderTemplate,
        summary?.recorded_at ?? summary?.created_at ?? null,
      );

    const fileName = `${sanitizeFileName(
      result.title || summary?.title || "Untitled",
    )}.md`;
    const desiredPath = normalizePath(folder ? `${folder}/${fileName}` : fileName);

    await ensureFolder(vault, folder);

    // If we've seen this note before, update the existing file even if its
    // title/folder changed (move + modify), so we never duplicate.
    const knownPath = this.plugin.settings.fileIndex[result.noteId];
    const existing = knownPath
      ? vault.getAbstractFileByPath(knownPath)
      : null;

    if (existing instanceof TFile) {
      if (knownPath !== desiredPath) {
        await ensureFolder(vault, folder);
        await this.plugin.app.fileManager.renameFile(existing, desiredPath);
      }
      await vault.modify(existing, result.markdown ?? "");
      this.plugin.settings.fileIndex[result.noteId] = desiredPath;
      return;
    }

    // No tracked file. Reuse a file already at the target path (e.g. a prior
    // install) instead of creating "Title 1.md".
    const atPath = vault.getAbstractFileByPath(desiredPath);
    if (atPath instanceof TFile) {
      await vault.modify(atPath, result.markdown ?? "");
    } else {
      await vault.create(desiredPath, result.markdown ?? "");
    }
    this.plugin.settings.fileIndex[result.noteId] = desiredPath;
  }

  private summaryMessage(imported: number, failed: number, upToDate: boolean): string {
    if (upToDate) return "Ruune: already up to date ✓";
    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} note${imported === 1 ? "" : "s"} synced`);
    if (failed > 0) parts.push(`${failed} failed`);
    return `Ruune: ${parts.join(", ")}`;
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────

/** Illegal-in-most-filesystems chars, plus Obsidian's own reserved set. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Untitled").slice(0, 180);
}

function sanitizeFolderSegment(seg: string): string {
  return seg
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a folder template locally (fallback for when the server didn't).
 * Supports {{date}} (YYYY-MM-DD), {{year}}, {{month}}, {{day}} against the
 * note's recording/creation date.
 */
export function resolveFolderTemplate(
  template: string,
  isoDate: string | null,
): string {
  const tpl = (template ?? "").trim();
  if (!tpl) return "";

  const d = isoDate ? new Date(isoDate) : new Date();
  const valid = !Number.isNaN(d.getTime());
  const yyyy = valid ? String(d.getFullYear()) : "";
  const mm = valid ? String(d.getMonth() + 1).padStart(2, "0") : "";
  const dd = valid ? String(d.getDate()).padStart(2, "0") : "";
  const date = valid ? `${yyyy}-${mm}-${dd}` : "";

  const resolved = tpl
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .replace(/\{\{\s*year\s*\}\}/gi, yyyy)
    .replace(/\{\{\s*month\s*\}\}/gi, mm)
    .replace(/\{\{\s*day\s*\}\}/gi, dd);

  return resolved
    .split("/")
    .map(sanitizeFolderSegment)
    .filter((seg) => seg.length > 0)
    .join("/");
}

/** Create the folder (and parents) if it doesn't already exist. */
async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  const path = normalizePath(folder ?? "");
  if (!path || path === "/" || path === ".") return;
  if (vault.getAbstractFileByPath(path)) return;
  try {
    await vault.createFolder(path);
  } catch (err) {
    // Concurrent create or already-exists race — ignore if it now exists.
    if (!vault.getAbstractFileByPath(path)) throw err;
  }
}
