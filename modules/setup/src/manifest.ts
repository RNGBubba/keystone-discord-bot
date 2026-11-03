import { defineModule } from "@keystone/kernel";
import { setup } from "./commands/setup";
import { setupDefaultSettings, setupSettingsSchema } from "./settings";
import { config } from "./commands/config";
import { exportCommand } from "./commands/export";

/**
 * Setup owns the operator's first questions: is this deployment ready, and what
 * is configured here? Both commands are read-through views of state that other
 * modules already own (`/setup` reads health, `/config` reads `SettingsService`).
 *
 * Writes go through `SettingsService.update`, so `/config set` is validated by
 * the target module's own Zod schema — the same schema the dashboard uses. A
 * second settings path would be a second source of truth; this module does not
 * add one.
 */
export const setupModule = defineModule({
  id: "setup",
  name: "Setup",
  description: "First-run readiness checks and per-guild module settings.",
  version: "0.3.0",
  settingsSchema: setupSettingsSchema,
  defaultSettings: setupDefaultSettings,
  intents: ["Guilds"],
  permissions: [],
  commands: [setup, config, exportCommand],
  docsPath: "04-Modules/setup/Spec.md",
});
