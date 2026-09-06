import { requestUrl } from "obsidian";
import type { ExportResponse, ListNotesResponse } from "./types";

/**
 * Thin client for the Ruune `obsidian-sync` Edge Function.
 *
 * We use Obsidian's `requestUrl` (not fetch) so requests work on mobile and
 * aren't subject to browser CORS — the plugin runs in the app, not a webpage.
 */
export class RuuneApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RuuneApiError";
  }
}

export interface ListNotesOptions {
  updatedSince?: string | null;
  perPage?: number;
  /** "all" (default) | "true" (archived only) | null (active only). */
  archived?: string | null;
}

export interface ExportOptions {
  noteIds: string[];
  includeTranscript?: boolean;
  folderTemplate?: string | null;
}

export class RuuneApi {
  /**
   * @param baseUrl Sync API base, e.g. https://obsidian.ruune.ai. The public
   *   domain is a stateless Cloudflare proxy in front of the `obsidian-sync`
   *   Edge Function, so we hit `{baseUrl}/notes` and `{baseUrl}/export`
   *   directly. For self-host/staging, a raw functions base also works:
   *   `https://<ref>.supabase.co/functions/v1/obsidian-sync`.
   * @param token   Plugin token (ruune_obs_...).
   */
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private endpoint(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    return `${base}/${path.replace(/^\/+/, "")}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /** Fetch one incremental page of notes from the given watermark. */
  async listNotes(opts: ListNotesOptions = {}): Promise<ListNotesResponse> {
    const params = new URLSearchParams();
    if (opts.updatedSince) params.set("updated_since", opts.updatedSince);
    params.set("per_page", String(opts.perPage ?? 100));
    params.set("archived", opts.archived ?? "all");

    const res = await requestUrl({
      url: `${this.endpoint("notes")}?${params.toString()}`,
      method: "GET",
      headers: this.authHeaders(),
      throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new RuuneApiError(this.errorText(res), res.status);
    }
    return res.json as ListNotesResponse;
  }

  /** Build markdown for a batch of note IDs (with frontmatter). */
  async exportNotes(opts: ExportOptions): Promise<ExportResponse> {
    const res = await requestUrl({
      url: this.endpoint("export"),
      method: "POST",
      headers: this.authHeaders(),
      throw: false,
      body: JSON.stringify({
        noteIds: opts.noteIds,
        includeTranscript: opts.includeTranscript ?? false,
        folderTemplate: opts.folderTemplate ?? null,
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new RuuneApiError(this.errorText(res), res.status);
    }
    return res.json as ExportResponse;
  }

  /** Lightweight auth check used by the settings "Test connection" button. */
  async testConnection(): Promise<void> {
    await this.listNotes({ perPage: 1 });
  }

  private errorText(res: { status: number; json?: unknown; text?: string }): string {
    const body = res.json as { error?: string } | undefined;
    if (body?.error) return body.error;
    if (res.status === 401) return "Invalid or expired token.";
    if (res.status === 403) return "This token doesn't have access.";
    if (res.status === 429) return "Rate limited — try again shortly.";
    return `Request failed (HTTP ${res.status}).`;
  }
}
