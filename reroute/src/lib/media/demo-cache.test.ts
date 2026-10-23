/** The committed demo recording (`demo-cache/`, written by scripts/record-demo-cache.ts) must be metadata only. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "demo-cache");

async function fixtures(): Promise<{ name: string; text: string }[]> {
  const entries = await readdir(ROOT, { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  return Promise.all(files.map(async (f) => ({ name: path.relative(ROOT, f), text: await readFile(f, "utf8") })));
}

describe("demo-cache fixtures", () => {
  it("exist for both sources, are recordings with a date, and are JSON only", async () => {
    const all = await fixtures();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((f) => f.name.split(path.sep)[0]))).toEqual(new Set(["scoreplay", "twelvelabs"]));
    for (const f of all) {
      expect(f.name).toMatch(/^(scoreplay|twelvelabs)[\\/][0-9a-f]{32}\.json$/);
      const r = JSON.parse(f.text);
      expect(r).toMatchObject({ source: f.name.split(path.sep)[0], recordedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/) });
      expect(r).toHaveProperty("value");
    }
  });

  it("contain no URLs at all (protected footage links), no storage locators, no e-mails, no secrets, no tokens", async () => {
    for (const { name, text } of await fixtures()) {
      expect({ name, email: /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i.test(text), storage: /"(aws_[a-z_]*|[a-z_]*bucket[a-z_]*)"\s*:/i.test(text) }).toEqual({ name, email: false, storage: false });
      expect({ name, url: /https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|\bwww\.[a-z0-9-]+\.|amazonaws\.com|cdn\.scoreplay\.io/i.test(text) }).toEqual({ name, url: false });
      expect({ name, signedUrl: /https?:\/\/[^\s"]*[?#]/i.test(text) }).toEqual({ name, signedUrl: false });
      expect({ name, queryChar: text.includes("?") }).toEqual({ name, queryChar: false });
      expect({ name, secret: /tlk_|sb_secret_|sb_publishable_|Signature|X-Amz-|Key-Pair-Id/.test(text) }).toEqual({ name, secret: false });
      expect({ name, tokenKey: /"[^"]*(token|signature|api[-_]?key|secret|password)[^"]*"\s*:/i.test(text) }).toEqual({ name, tokenKey: false });
    }
  });
});
