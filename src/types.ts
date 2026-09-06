// Wire types shared with the `obsidian-sync` Edge Function
// (ruune-server/supabase/functions/obsidian-sync). Keep in sync with
// `toNoteSummary` and the export ExportResult shape on the server.

export interface NoteLabel {
  id: string;
  name: string;
  color?: string | null;
}

/** A single note as returned by `GET /notes` (mirrors `toNoteSummary`). */
export interface NoteSummary {
  id: string;
  title: string | null;
  summary: string | null;
  status: string | null;
  labels: NoteLabel[];
  archived: boolean;
  archived_at: string | null;
  duration_seconds: number | null;
  recording_id: string | null;
  recorded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ListMeta {
  page: number;
  per_page: number;
  total: number;
  /** Keyset cursor: pass back as the next `updated_since`. */
  next_updated_since?: string | null;
}

export interface ListNotesResponse {
  data: NoteSummary[];
  meta: ListMeta;
}

/** One entry in the `POST /export` results array. */
export interface ExportResult {
  noteId: string;
  status: "success" | "failed";
  title?: string;
  markdown?: string;
  folder?: string;
  updatedAt?: string | null;
  error?: string;
}

export interface ExportResponse {
  success: boolean;
  exported: number;
  total: number;
  results: ExportResult[];
}
