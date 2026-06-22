import type { Command } from "commander";
import { ReaderClient } from "@vakra-dev/reader-js";
import { getApiKey, getApiUrl } from "../utils/config.js";
import { outputContent, outputJson, saveScreenshot, info, error } from "../utils/output.js";

export function registerScrapeCommand(program: Command): void {
  program
    .command("scrape <url>")
    .description("Scrape a URL and output content")
    .option("-f, --format <format>", "Output format: markdown (default), html, screenshot", "markdown")
    .option("--json", "Output full JSON response")
    .option("-o, --output <file>", "Write output to file")
    .option("--no-main-content", "Include full page (nav, header, footer)")
    .option("--include-tags <selectors>", "CSS selectors to include (comma-separated)")
    .option("--exclude-tags <selectors>", "CSS selectors to exclude (comma-separated)")
    .option("--wait-for <selector>", "Wait for CSS selector before scraping")
    .option("--timeout <ms>", "Timeout in milliseconds", "30000")
    .option("--proxy-mode <mode>", "Proxy mode: standard, stealth, auto")
    .action(async (url: string, opts) => {
      const apiKey = getApiKey();
      const client = new ReaderClient({ apiKey, baseUrl: getApiUrl() });

      const formats: Array<"markdown" | "html" | "screenshot"> = [];
      const requestedFormat = opts.format as string;

      if (requestedFormat === "screenshot") {
        formats.push("screenshot");
      } else if (requestedFormat === "html") {
        formats.push("html");
      } else {
        formats.push("markdown");
      }

      // If screenshot requested alongside another format
      if (requestedFormat !== "screenshot" && opts.output?.endsWith(".png")) {
        formats.push("screenshot");
      }

      try {
        const result = await client.read({
          url,
          formats,
          onlyMainContent: opts.mainContent !== false,
          includeTags: opts.includeTags?.split(",").map((s: string) => s.trim()),
          excludeTags: opts.excludeTags?.split(",").map((s: string) => s.trim()),
          waitForSelector: opts.waitFor,
          timeoutMs: parseInt(opts.timeout, 10),
          proxyMode: opts.proxyMode,
        });

        if (result.kind === "scrape") {
          const data = result.data;

          if (opts.json) {
            outputJson(data);
            return;
          }

          // Screenshot: save to file
          if (data.screenshot) {
            const path = saveScreenshot(data.screenshot, opts.output);
            info(`Screenshot saved to ${path}`);
            if (requestedFormat === "screenshot") return;
          }

          // Content output
          const content = data.markdown || data.html || "";
          if (opts.output && !opts.output.endsWith(".png")) {
            const { writeFileSync } = await import("fs");
            writeFileSync(opts.output, content);
            info(`Written to ${opts.output}`);
          } else {
            outputContent(content);
          }
        } else {
          // Job-based (batch) - wait for completion
          const job = result.data;
          if (opts.json) {
            outputJson(job);
          } else {
            for (const page of job.results) {
              outputContent(page.markdown || page.html || "");
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        error(msg);
        process.exit(1);
      }
    });
}
