import type { Command } from "commander";
import { loadConfig, saveConfig, redactKey } from "../utils/config.js";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("set <key> <value>")
    .description("Set a config value (api-key, api-url)")
    .action((key: string, value: string) => {
      const current = loadConfig();

      if (key === "api-key") {
        current.apiKey = value;
        saveConfig(current);
        console.error(`API key saved: ${redactKey(value)}`);
      } else if (key === "api-url") {
        current.apiUrl = value;
        saveConfig(current);
        console.error(`API URL saved: ${value}`);
      } else {
        console.error(`Unknown config key: ${key}`);
        console.error("Valid keys: api-key, api-url");
        process.exit(1);
      }
    });

  config
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const current = loadConfig();
      const envKey = process.env.READER_API_KEY;
      const envUrl = process.env.READER_API_URL;

      console.log("Configuration:");
      console.log("");

      if (envKey) {
        console.log(`  API Key:  ${redactKey(envKey)} (from READER_API_KEY env)`);
      } else if (current.apiKey) {
        console.log(`  API Key:  ${redactKey(current.apiKey)} (from ~/.reader/config.json)`);
      } else {
        console.log("  API Key:  not configured");
      }

      if (envUrl) {
        console.log(`  API URL:  ${envUrl} (from READER_API_URL env)`);
      } else if (current.apiUrl) {
        console.log(`  API URL:  ${current.apiUrl} (from ~/.reader/config.json)`);
      } else {
        console.log("  API URL:  https://api.reader.dev (default)");
      }
    });
}
