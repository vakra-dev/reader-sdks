/**
 * Output formatting for the Reader CLI.
 *
 * Default: plain content to stdout (markdown/html)
 * --json: full JSON response to stdout
 * Progress/errors: always stderr
 */

import { writeFileSync } from "fs";

export function info(msg: string): void {
  console.error(msg);
}

export function error(msg: string): void {
  console.error(`Error: ${msg}`);
}

export function outputContent(content: string): void {
  process.stdout.write(content);
}

export function outputJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function saveScreenshot(base64: string, outputPath?: string): string {
  const buffer = Buffer.from(base64, "base64");
  const path = outputPath || "screenshot.png";
  writeFileSync(path, buffer);
  return path;
}
