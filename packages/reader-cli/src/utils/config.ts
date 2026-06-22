/**
 * Config resolution for the Reader CLI.
 *
 * Priority: environment variables > config file (~/.reader/config.json)
 *
 * - READER_API_KEY env var: for AI agents and CI (no disk writes)
 * - reader config set api-key: for human users (persisted)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".reader");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ReaderConfig {
  apiKey?: string;
  apiUrl?: string;
}

export function loadConfig(): ReaderConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // Corrupted config, ignore
  }
  return {};
}

export function saveConfig(config: ReaderConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getApiKey(): string {
  // Env var takes precedence (agents/CI)
  if (process.env.READER_API_KEY) {
    return process.env.READER_API_KEY;
  }

  // Config file (humans)
  const config = loadConfig();
  if (config.apiKey) {
    return config.apiKey;
  }

  console.error("Error: No API key configured.\n");
  console.error("  For humans:  reader config set api-key <your-key>");
  console.error("  For agents:  export READER_API_KEY=<your-key>");
  console.error("\n  Get your key at https://console.reader.dev");
  process.exit(1);
}

export function getApiUrl(): string {
  return process.env.READER_API_URL || loadConfig().apiUrl || "https://api.reader.dev";
}

export function redactKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}
