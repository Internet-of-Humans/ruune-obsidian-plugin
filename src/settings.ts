import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type RuuneSyncPlugin from "./main";
import { RuuneApi } from "./api";

export interface RuuneSyncSettings {
  /**
   * Sync API base. Defaults to the public `https://obsidian.ruune.ai` domain
   * (a stateless proxy in front of the `obsidian-sync` Edge Function). For
   * self-host/staging, point it at the raw function:
   * `https://<ref>.supabase.co/functions/v1/obsidian-sync`.
   */
  baseUrl: string;
  /** Plugin token (ruune_obs_...). */
  token: string;
  /**
   * Vault folder template. Supports literal subfolders + date tokens, e.g.
   * `Ruune`, `Journal/{{date}}`, `Notes/{{year}}/{{month}}`. Tokens are
   * resolved locally by the plugin against each note's recording date.
   */
  folderTemplate: string;
  /** Include the full transcript in each exported note. */
  includeTranscript: boolean;
  /** Sync archived notes too. */
  includeArchived: boolean;
  /** Auto-sync interval in minutes. 0 disables the timer (manual only). */
  intervalMinutes: number;
  /** Run a sync when the vault opens. */
  syncOnStartup: boolean;

  // ── Sync state (managed by the engine, not the user) ──
  /** Keyset watermark: max updated_at we've imported. */
  lastSyncCursor: string | null;
  /** ISO timestamp of the last successful sync (for UI). */
  lastSyncAt: string | null;
  /** Map of noteId -> vault file path, so re-synced notes overwrite in place. */
  fileIndex: Record<string, string>;
}

export const DEFAULT_SETTINGS: RuuneSyncSettings = {
  // Public Ruune sync domain (Cloudflare proxy -> obsidian-sync function).
  // Override for self-host / staging with a raw functions base.
  baseUrl: "https://obsidian.ruune.ai",
  token: "",
  folderTemplate: "Ruune",
  includeTranscript: false,
  includeArchived: false,
  intervalMinutes: 15,
  syncOnStartup: true,
  lastSyncCursor: null,
  lastSyncAt: null,
  fileIndex: {},
};

const INTERVAL_OPTIONS: Record<string, string> = {
  "0": "Manual only",
  "5": "Every 5 minutes",
  "15": "Every 15 minutes",
  "30": "Every 30 minutes",
  "60": "Every hour",
};

export class RuuneSyncSettingTab extends PluginSettingTab {
  plugin: RuuneSyncPlugin;

  constructor(app: App, plugin: RuuneSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Dropdowns persist strings; intervalMinutes is a number. Convert on the
   * way in/out so the stored setting stays numeric.
   */
  getControlValue(key: string): unknown {
    if (key === "intervalMinutes") {
      return String(this.plugin.settings.intervalMinutes);
    }
    return super.getControlValue(key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "intervalMinutes") {
      this.plugin.settings.intervalMinutes = Number(value) || 0;
      await this.plugin.saveSettings();
      this.plugin.restartAutoSync();
      return;
    }
    if (key === "folderTemplate") {
      this.plugin.settings.folderTemplate = String(value ?? "").trim();
      await this.plugin.saveSettings();
      return;
    }
    await super.setControlValue(key, value);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const lastSync = this.plugin.settings.lastSyncAt
      ? new Date(this.plugin.settings.lastSyncAt).toLocaleString()
      : "never";

    return [
      {
        name: "Plugin token",
        desc:
          "Paste the plugin token from the Ruune app " +
          "(Settings → Integrations → Obsidian → Plugin token).",
        render: (setting) => {
          setting.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.addClass("ruune-token-input");
            text
              .setPlaceholder("ruune_obs_...")
              .setValue(this.plugin.settings.token)
              .onChange(async (value) => {
                this.plugin.settings.token = value.trim();
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Server URL",
        desc:
          "Advanced — leave as the default (obsidian.ruune.ai) unless you're " +
          "on self-hosted or staging Ruune.",
        render: (setting) => {
          setting.addText((text) => {
            text.inputEl.addClass("ruune-serverurl-input");
            text
              .setPlaceholder(DEFAULT_SETTINGS.baseUrl)
              .setValue(this.plugin.settings.baseUrl)
              .onChange(async (value) => {
                this.plugin.settings.baseUrl =
                  value.trim() || DEFAULT_SETTINGS.baseUrl;
                await this.plugin.saveSettings();
              });
          });
        },
      },
      {
        name: "Test connection",
        desc: "Verify your token can reach Ruune.",
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
              if (!this.plugin.settings.token) {
                new Notice("Ruune: add your plugin token first.");
                return;
              }
              btn.setDisabled(true).setButtonText("Testing…");
              try {
                const api = new RuuneApi(
                  this.plugin.settings.baseUrl,
                  this.plugin.settings.token,
                );
                await api.testConnection();
                new Notice("Ruune: connection OK ✓");
              } catch (err) {
                new Notice(
                  `Ruune: connection failed — ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              } finally {
                btn.setDisabled(false).setButtonText("Test");
              }
            }),
          );
        },
      },
      {
        type: "group",
        heading: "Output",
        items: [
          {
            name: "Folder",
            desc:
              "Where notes are written. Supports date tokens: {{date}} (YYYY-MM-DD), " +
              "{{year}}, {{month}}, {{day}}. Example: Journal/{{date}}",
            control: {
              type: "text",
              key: "folderTemplate",
              placeholder: "Ruune",
            },
          },
          {
            name: "Include transcript",
            desc: "Append the full transcript below each note's summary.",
            control: { type: "toggle", key: "includeTranscript" },
          },
          {
            name: "Include archived notes",
            desc: "Also sync notes you've archived in Ruune.",
            control: { type: "toggle", key: "includeArchived" },
          },
        ],
      },
      {
        type: "group",
        heading: "Schedule",
        items: [
          {
            name: "Auto-sync interval",
            desc: "How often to check Ruune for new/updated notes.",
            control: {
              type: "dropdown",
              key: "intervalMinutes",
              options: INTERVAL_OPTIONS,
            },
          },
          {
            name: "Sync on startup",
            desc: "Run a sync automatically when this vault opens.",
            control: { type: "toggle", key: "syncOnStartup" },
          },
        ],
      },
      {
        type: "group",
        heading: "Sync",
        items: [
          {
            name: "Sync now",
            desc: `Last synced: ${lastSync}`,
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setButtonText("Sync now")
                  .setCta()
                  .onClick(async () => {
                    await this.plugin.runSync("manual");
                    this.update();
                  }),
              );
            },
          },
          {
            name: "Reset sync state",
            desc:
              "Forget what's been synced so the next sync re-imports every note. " +
              "Existing files are overwritten, not duplicated.",
            render: (setting) => {
              setting.addButton((btn) =>
                btn
                  .setDestructive()
                  .setButtonText("Reset")
                  .onClick(async () => {
                    this.plugin.settings.lastSyncCursor = null;
                    this.plugin.settings.fileIndex = {};
                    await this.plugin.saveSettings();
                    new Notice(
                      "Ruune: sync state reset. Next sync re-imports all notes.",
                    );
                  }),
              );
            },
          },
        ],
      },
    ];
  }
}
