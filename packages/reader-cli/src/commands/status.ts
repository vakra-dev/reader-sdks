import type { Command } from "commander";
import { ReaderClient } from "@vakra-dev/reader-js";
import { getApiKey, getApiUrl, redactKey } from "../utils/config.js";
import { version } from "../version.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show CLI version, API connectivity, and credits")
    .action(async () => {
      const apiKey = getApiKey();
      const apiUrl = getApiUrl();
      const client = new ReaderClient({ apiKey, baseUrl: apiUrl });

      console.log(`Reader CLI v${version}`);
      console.log(`API:     ${apiUrl}`);
      console.log(`Key:     ${redactKey(apiKey)}`);

      try {
        const credits = await client.getCredits();
        console.log(`Credits: ${credits.balance} / ${credits.limit} (${credits.tier} tier)`);
        console.log(`Resets:  ${credits.resetAt}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`API:     connection failed (${msg})`);
        process.exit(1);
      }
    });
}
