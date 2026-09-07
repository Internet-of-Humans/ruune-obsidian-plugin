import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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

export class RuuneSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: RuuneSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Connection ──
    new Setting(containerEl).setName("Connection").setHeading();

    new Setting(containerEl)
      .setName("Plugin token")
      .setDesc(
        "Paste the Obsidian plugin token from the Ruune app " +
          "(Settings → Integrations → Obsidian → Plugin token).",
      )
      .addText((text) => {
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

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc(
        "Advanced — leave as the default (obsidian.ruune.ai) unless you're " +
          "on self-hosted or staging Ruune.",
      )
      .addText((text) => {
        text.inputEl.addClass("ruune-serverurl-input");
        text
          .setPlaceholder(DEFAULT_SETTINGS.baseUrl)
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value.trim() || DEFAULT_SETTINGS.baseUrl;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Verify your token can reach Ruune.")
      .addButton((btn) =>
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

    // ── Output ──
    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Folder")
      .setDesc(
        "Where notes are written. Supports date tokens: {{date}} (YYYY-MM-DD), " +
          "{{year}}, {{month}}, {{day}}. Example: Journal/{{date}}",
      )
      .addText((text) =>
        text
          .setPlaceholder("Ruune")
          .setValue(this.plugin.settings.folderTemplate)
          .onChange(async (value) => {
            this.plugin.settings.folderTemplate = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include transcript")
      .setDesc("Append the full transcript below each note's summary.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeTranscript)
          .onChange(async (value) => {
            this.plugin.settings.includeTranscript = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include archived notes")
      .setDesc("Also sync notes you've archived in Ruune.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeArchived)
          .onChange(async (value) => {
            this.plugin.settings.includeArchived = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Schedule ──
    new Setting(containerEl).setName("Schedule").setHeading();

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("How often to check Ruune for new/updated notes.")
      .addDropdown((dd) => {
        dd.addOption("0", "Manual only");
        dd.addOption("5", "Every 5 minutes");
        dd.addOption("15", "Every 15 minutes");
        dd.addOption("30", "Every 30 minutes");
        dd.addOption("60", "Every hour");
        dd.setValue(String(this.plugin.settings.intervalMinutes));
        dd.onChange(async (value) => {
          this.plugin.settings.intervalMinutes = Number(value) || 0;
          await this.plugin.saveSettings();
          this.plugin.restartAutoSync();
        });
      });

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Run a sync automatically when this vault opens.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Actions ──
    new Setting(containerEl).setName("Sync").setHeading();

    const lastSync = this.plugin.settings.lastSyncAt
      ? new Date(this.plugin.settings.lastSyncAt).toLocaleString()
      : "never";

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(`Last synced: ${lastSync}`)
      .addButton((btn) =>
        btn
          .setButtonText("Sync now")
          .setCta()
          .onClick(async () => {
            await this.plugin.runSync("manual");
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Reset sync state")
      .setDesc(
        "Forget what's been synced so the next sync re-imports every note. " +
          "Existing files are overwritten, not duplicated.",
      )
      .addButton((btn) =>
        btn
          // setWarning() (not setDestructive()) keeps compatibility with the
          // declared minAppVersion; setDestructive() only exists in 1.13.0+.
          .setWarning()
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings.lastSyncCursor = null;
            this.plugin.settings.fileIndex = {};
            await this.plugin.saveSettings();
            new Notice("Ruune: sync state reset. Next sync re-imports all notes.");
          }),
      );
  }
}
