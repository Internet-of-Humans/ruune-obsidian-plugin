import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  RuuneSyncSettingTab,
  type RuuneSyncSettings,
} from "./settings";
import { SyncEngine, type SyncTrigger } from "./sync";

export default class RuuneSyncPlugin extends Plugin {
  settings!: RuuneSyncSettings;
  private engine!: SyncEngine;
  private statusBar: HTMLElement | null = null;
  private intervalId: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.engine = new SyncEngine(this);

    this.addSettingTab(new RuuneSyncSettingTab(this.app, this));

    this.statusBar = this.addStatusBarItem();
    this.setStatus(
      this.settings.token ? "Ruune: idle" : "Ruune: not connected",
    );

    this.addRibbonIcon("refresh-cw", "Sync Ruune notes", () => {
      void this.runSync("manual");
    });

    this.addCommand({
      id: "ruune-sync-now",
      name: "Sync now",
      callback: () => void this.runSync("manual"),
    });

    this.addCommand({
      id: "ruune-open-settings",
      name: "Open settings",
      callback: () => {
        // @ts-expect-error — setting is available at runtime.
        this.app.setting.open();
        // @ts-expect-error — openTabById is available at runtime.
        this.app.setting.openTabById(this.manifest.id);
      },
    });

    // Defer startup work until the workspace (and vault index) is ready.
    this.app.workspace.onLayoutReady(() => {
      this.restartAutoSync();
      if (this.settings.syncOnStartup && this.settings.token) {
        // Small delay so we don't compete with vault load.
        window.setTimeout(() => void this.runSync("startup"), 3000);
      }
    });
  }

  onunload(): void {
    this.clearAutoSync();
  }

  async runSync(trigger: SyncTrigger): Promise<void> {
    await this.engine.run(trigger);
  }

  setStatus(text: string): void {
    this.statusBar?.setText(text);
  }

  /** (Re)arm the auto-sync timer from current settings. */
  restartAutoSync(): void {
    this.clearAutoSync();
    const minutes = this.settings.intervalMinutes;
    if (!minutes || minutes <= 0) return;
    this.intervalId = window.setInterval(
      () => {
        if (this.settings.token) void this.runSync("interval");
      },
      minutes * 60 * 1000,
    );
    this.registerInterval(this.intervalId);
  }

  private clearAutoSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // fileIndex must be an object even if older data had it missing/null.
    if (!this.settings.fileIndex || typeof this.settings.fileIndex !== "object") {
      this.settings.fileIndex = {};
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
