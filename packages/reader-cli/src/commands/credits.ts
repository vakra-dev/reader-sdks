import type { Command } from "commander";
import { ReaderClient } from "@vakra-dev/reader-js";
import { getApiKey, getApiUrl } from "../utils/config.js";
import { outputJson, error } from "../utils/output.js";

export function registerCreditsCommand(program: Command): void {
  program
    .command("credits")
    .description("Check credit balance and usage")
    .option("--json", "Output full JSON response")
    .action(async (opts) => {
      const apiKey = getApiKey();
      const client = new ReaderClient({ apiKey, baseUrl: getApiUrl() });

      try {
        const credits = await client.getCredits();

        if (opts.json) {
          outputJson(credits);
          return;
        }

        console.log(`Balance: ${credits.balance} / ${credits.limit}`);
        console.log(`Used:    ${credits.used}`);
        console.log(`Tier:    ${credits.tier}`);
        console.log(`Resets:  ${credits.resetAt}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        error(msg);
        process.exit(1);
      }
    });
}
