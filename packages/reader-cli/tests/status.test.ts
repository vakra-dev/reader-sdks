/**
 * Status and credits command tests
 *
 * Tests against the live Reader API. Requires READER_API_KEY env var.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

const CLI = "npx tsx src/index.ts";
const CWD = join(import.meta.dirname, "..");
const API_KEY = process.env.READER_API_KEY;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    cwd: CWD,
    env: { ...process.env, READER_API_KEY: API_KEY },
    encoding: "utf-8",
    timeout: 15000,
  }).trim();
}

function runFail(args: string, env?: Record<string, string>): string {
  try {
    execSync(`${CLI} ${args}`, {
      cwd: CWD,
      env: { ...process.env, ...env },
      encoding: "utf-8",
      timeout: 15000,
    });
    return "";
  } catch (err: any) {
    return (err.stderr || err.stdout || "").trim();
  }
}

describe.skipIf(!API_KEY)("status command (live API)", () => {
  it("shows version, API URL, key, and credits", () => {
    const output = run("status");
    expect(output).toContain("Reader CLI v");
    expect(output).toContain("api.reader.dev");
    expect(output).toContain("Credits:");
    expect(output).toContain("tier");
  });

  it("shows redacted API key", () => {
    const output = run("status");
    // Key should be redacted: rdr_...XXXX
    expect(output).toMatch(/rdr_\.\.\.\w{4}/);
    // Full key should NOT appear
    expect(output).not.toContain(API_KEY);
  });
});

describe.skipIf(!API_KEY)("credits command (live API)", () => {
  it("shows balance, used, tier, and reset date", () => {
    const output = run("credits");
    expect(output).toContain("Balance:");
    expect(output).toContain("Used:");
    expect(output).toContain("Tier:");
    expect(output).toContain("Resets:");
  });

  it("outputs JSON with --json flag", () => {
    const output = run("credits --json");
    const data = JSON.parse(output);
    expect(data.balance).toBeDefined();
    expect(data.limit).toBeDefined();
    expect(data.used).toBeDefined();
    expect(data.tier).toBeDefined();
    expect(typeof data.balance).toBe("number");
  });
});

describe("auth errors", () => {
  it("exits with error when no API key configured", () => {
    const output = runFail("status", {
      READER_API_KEY: "",
      HOME: "/tmp/reader-cli-no-config-test",
    });
    expect(output).toContain("No API key");
  });

  it("exits with error for invalid API key", () => {
    const output = runFail("status", {
      READER_API_KEY: "rdr_invalid_key_that_does_not_exist",
    });
    expect(output).toContain("connection failed");
  });
});
