import { Command } from "commander";
import { registerScrapeCommand } from "./commands/scrape.js";
import { registerCrawlCommand } from "./commands/crawl.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerCreditsCommand } from "./commands/credits.js";
import { registerConfigCommand } from "./commands/config.js";
import { version } from "./version.js";

const program = new Command();

program
  .name("reader")
  .description("Read the web for your AI agents. Powered by reader.dev.")
  .version(version);

registerConfigCommand(program);
registerStatusCommand(program);
registerScrapeCommand(program);
registerCrawlCommand(program);
registerCreditsCommand(program);

program.parse();
