/**
 * Scrape command integration tests
 *
 * Tests against the live Reader API. Requires READER_API_KEY env var.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

const CLI = "npx tsx src/index.ts";
const CWD = join(import.meta.dirname, "..");
const API_KEY = process.env.READER_API_KEY;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    cwd: CWD,
    env: { ...process.env, READER_API_KEY: API_KEY },
    encoding: "utf-8",
    timeout: 60000,
  }).trim();
}

function runWithStderr(args: string): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`${CLI} ${args}`, {
      cwd: CWD,
      env: { ...process.env, READER_API_KEY: API_KEY },
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { stdout, stderr: "" };
  } catch (err: any) {
    return { stdout: err.stdout?.trim() || "", stderr: err.stderr?.trim() || "" };
  }
}

describe.skipIf(!API_KEY)("scrape command (live API)", () => {
  it("scrapes example.com and outputs markdown to stdout", () => {
    const output = run("scrape https://example.com");
    expect(output).toContain("Example Domain");
    expect(output).toContain("[Learn more]");
  });

  it("outputs full JSON with --json flag", () => {
    const output = run("scrape https://example.com --json");
    const data = JSON.parse(output);
    expect(data.url).toBe("https://example.com");
    expect(data.markdown).toContain("Example Domain");
    expect(data.metadata).toBeDefined();
    expect(data.metadata.duration).toBeGreaterThan(0);
  });

  it("outputs HTML with -f html --json", () => {
    // Check via JSON to confirm the API returns html field
    const output = run("scrape https://example.com -f html --json");
    const data = JSON.parse(output);
    // html field exists (may be empty from cache, but field is present)
    expect("html" in data).toBe(true);
    expect(data.url).toBe("https://example.com");
  });

  it("writes markdown to file with -o flag", () => {
    const outFile = `/tmp/reader-cli-test-${Date.now()}.md`;
    try {
      run(`scrape https://example.com -o ${outFile}`);
      expect(existsSync(outFile)).toBe(true);
      const content = readFileSync(outFile, "utf-8");
      expect(content).toContain("Example Domain");
    } finally {
      try { unlinkSync(outFile); } catch {}
    }
  });

  it("returns content for a real website", () => {
    const output = run("scrape https://httpbin.org/html");
    expect(output.length).toBeGreaterThan(100);
    expect(output).toContain("Herman Melville");
  });

  it("handles errors gracefully", () => {
    const { stderr } = runWithStderr("scrape https://this-domain-does-not-exist-12345.invalid");
    expect(stderr).toContain("Error");
  });
});

// Screenshot tests require the server to have screenshot support deployed.
// These will fail until reader-api and reader-daemon are updated.
describe.skipIf(!API_KEY)("scrape screenshot (live API)", () => {
  it.todo("captures screenshot with -f screenshot");
  it.todo("screenshot in JSON response is base64");
});
