/**
 * Config command tests
 *
 * Tests config resolution, persistence, and display.
 * Uses isolated HOME directory to avoid polluting real config.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = "npx tsx src/index.ts";
const CWD = join(import.meta.dirname, "..");

let testHome: string;

beforeEach(() => {
  testHome = join(tmpdir(), `reader-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function run(args: string, extraEnv?: Record<string, string>): string {
  return execSync(`${CLI} ${args}`, {
    cwd: CWD,
    env: { ...process.env, HOME: testHome, READER_API_KEY: "", READER_API_URL: "", ...extraEnv },
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
}

function runStderr(args: string, extraEnv?: Record<string, string>): string {
  try {
    execSync(`${CLI} ${args}`, {
      cwd: CWD,
      env: { ...process.env, HOME: testHome, READER_API_KEY: "", READER_API_URL: "", ...extraEnv },
      encoding: "utf-8",
      timeout: 10000,
    });
    return "";
  } catch (err: any) {
    return (err.stderr || err.stdout || "").trim();
  }
}

describe("config commands", () => {
  it("config set api-key saves and config show displays it", () => {
    run("config set api-key rdr_test_key_abcd1234");
    const output = run("config show");
    expect(output).toContain("rdr_...1234");
    expect(output).toContain("config.json");
  });

  it("config set api-url saves custom URL", () => {
    run("config set api-url https://custom.example.com");
    const output = run("config show");
    expect(output).toContain("https://custom.example.com");
    expect(output).toContain("config.json");
  });

  it("env var takes precedence over config file", () => {
    run("config set api-key rdr_file_key_5678");
    const output = run("config show", { READER_API_KEY: "rdr_env_key_abcd" });
    expect(output).toContain("rdr_...abcd");
    expect(output).toContain("READER_API_KEY env");
  });

  it("shows default API URL when not configured", () => {
    const output = run("config show", { READER_API_KEY: "rdr_test" });
    expect(output).toContain("https://api.reader.dev");
    expect(output).toContain("default");
  });

  it("shows not configured when no key set", () => {
    const output = run("config show");
    expect(output).toContain("not configured");
  });

  it("rejects unknown config keys", () => {
    const output = runStderr("config set unknown-key value");
    expect(output).toContain("Unknown config key");
  });
});
