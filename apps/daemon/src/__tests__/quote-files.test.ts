import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadQuotes } from "../outputs/discord/rvc-scheduler.js";

const quotesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "quotes"
);

describe("bundled quote files", () => {
  it("loads the Vietnamese wisdom default file", async () => {
    const quotes = await loadQuotes(path.join(quotesDir, "vietnamese-wisdom.txt"));
    expect(quotes.length).toBeGreaterThanOrEqual(10);
    for (const quote of quotes) {
      expect(quote).not.toMatch(/^#/);
      expect(quote.length).toBeGreaterThan(0);
    }
  });

  it("loads the Chinese philosophy default file", async () => {
    const quotes = await loadQuotes(path.join(quotesDir, "chinese-philosophy.txt"));
    expect(quotes.length).toBeGreaterThanOrEqual(10);
    for (const quote of quotes) {
      expect(quote).not.toMatch(/^#/);
      expect(quote.length).toBeGreaterThan(0);
    }
  });

  it("returns an empty list instead of throwing for a missing file", async () => {
    const quotes = await loadQuotes(path.join(quotesDir, "does-not-exist.txt"));
    expect(quotes).toEqual([]);
  });
});
