import type { Command } from "commander";
import { ReaderClient } from "@vakra-dev/reader-js";
import { getApiKey, getApiUrl } from "../utils/config.js";
import { outputContent, outputJson, info, error } from "../utils/output.js";

export function registerCrawlCommand(program: Command): void {
  program
    .command("crawl <url>")
    .description("Crawl a website and output discovered pages")
    .option("--max-depth <n>", "Maximum crawl depth", "2")
    .option("--max-pages <n>", "Maximum pages to crawl", "20")
    .option("--urls-only", "Only output discovered URLs, don't scrape content")
    .option("--json", "Output full JSON response")
    .option("-o, --output-dir <dir>", "Write each page to a separate file")
    .action(async (url: string, opts) => {
      const apiKey = getApiKey();
      const client = new ReaderClient({ apiKey, baseUrl: getApiUrl() });

      info(`Crawling ${url} (depth: ${opts.maxDepth}, max: ${opts.maxPages} pages)...`);

      try {
        const result = await client.read({
          url,
          maxDepth: parseInt(opts.maxDepth, 10),
          maxPages: parseInt(opts.maxPages, 10),
          formats: opts.urlsOnly ? [] : ["markdown"],
        });

        if (result.kind !== "job") {
          error("Unexpected response - expected a crawl job");
          process.exit(1);
        }

        const job = result.data;

        if (opts.json) {
          outputJson(job);
          return;
        }

        if (opts.urlsOnly || job.results.length === 0) {
          // Output one URL per line
          for (const page of job.results) {
            outputContent(page.url + "\n");
          }
          info(`\n${job.results.length} URLs discovered`);
          return;
        }

        // Output each page's content
        if (opts.outputDir) {
          const { mkdirSync, writeFileSync } = await import("fs");
          mkdirSync(opts.outputDir, { recursive: true });

          for (const page of job.results) {
            const slug = new URL(page.url).pathname
              .replace(/\//g, "_")
              .replace(/^_/, "")
              .replace(/_$/, "") || "index";
            const filename = `${opts.outputDir}/${slug}.md`;
            writeFileSync(filename, page.markdown || page.html || "");
          }
          info(`${job.results.length} pages written to ${opts.outputDir}/`);
        } else {
          for (let i = 0; i < job.results.length; i++) {
            const page = job.results[i];
            if (i > 0) outputContent("\n---\n\n");
            outputContent(`# ${page.url}\n\n`);
            outputContent(page.markdown || page.html || "");
          }
          info(`\n${job.results.length} pages crawled`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        error(msg);
        process.exit(1);
      }
    });
}
