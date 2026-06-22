/**
 * Crawl command integration tests
 *
 * Tests against the live Reader API. Requires READER_API_KEY env var.
 * Crawls can take 30-120 seconds, so timeouts are generous.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readdirSync, rmSync, readFileSync } from "fs";

const CLI = "npx tsx src/index.ts";
const CWD = join(import.meta.dirname, "..");
const API_KEY = process.env.READER_API_KEY;

function run(args: string): string {
  return execSync(`${CLI} ${args}`, {
    cwd: CWD,
    env: { ...process.env, READER_API_KEY: API_KEY },
    encoding: "utf-8",
    timeout: 180000, // 3 minutes for crawls
  }).trim();
}

describe.skipIf(!API_KEY)("crawl command (live API)", () => {
  it("crawls example.com and outputs markdown", () => {
    const output = run("crawl https://example.com --max-pages 2 --max-depth 1");
    expect(output).toContain("example.com");
  }, 120000);

  it("outputs JSON with --json flag", () => {
    const output = run("crawl https://example.com --max-pages 2 --max-depth 1 --json");
    const data = JSON.parse(output);
    expect(data.status).toBe("completed");
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
  }, 120000);

  it("writes pages to output directory", () => {
    const outDir = `/tmp/reader-cli-crawl-${Date.now()}`;
    try {
      run(`crawl https://example.com --max-pages 2 --max-depth 1 -o ${outDir}`);
      expect(existsSync(outDir)).toBe(true);
      const files = readdirSync(outDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.endsWith(".md"))).toBe(true);
      // Check content of first file
      const content = readFileSync(join(outDir, files[0]), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 120000);
});
