/**
 * Issues named reviewer credentials for REROUTE sign-in.
 *
 *   pnpm exec tsx scripts/reviewer-credentials.ts ed="Ed Smith" jo="Jo Lee"     # run from reroute/
 *
 * For every `id=Display Name` it generates a strong random passcode (24 chars from a readable alphabet, shown
 * in groups of 4) and its scrypt hash. Plaintext passcodes are written ONLY to `.reviewers.local.txt` (mode 600,
 * gitignored via `.reviewers.local*`; overwritten on each run) for you to hand out individually. stdout gets ONLY
 * the `REROUTE_REVIEWERS=…` line (ids, display names, salts, hashes — no plaintext) to paste into the deployment
 * env / .env.local. Re-running for an id rotates that reviewer: their existing sessions stop working.
 */
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { SCRYPT_SALT_BYTES, hashPasscode, parseReviewers, type ReviewerCredential } from "../src/lib/server/auth";

const OUT_FILE = ".reviewers.local.txt";
/** No 0/o, 1/l/i look-alikes. 31 symbols × 24 chars ≈ 119 bits. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const PASSCODE_CHARS = 24;

function generatePasscode(): string {
  const chars = Array.from({ length: PASSCODE_CHARS }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return chars.join("").match(/.{4}/g)!.join("-");
}

function fail(message: string): never {
  console.error(`reviewer-credentials: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) fail('usage: tsx scripts/reviewer-credentials.ts <id>="<Display Name>" [...]');

  const gitignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8").catch(() => "");
  if (!gitignore.split("\n").some((line) => line.trim() === ".reviewers.local*")) {
    fail(`run from reroute/ — its .gitignore must cover ${OUT_FILE} (.reviewers.local*) before passcodes are written`);
  }

  const issued: { credential: ReviewerCredential; passcode: string }[] = [];
  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq <= 0) fail(`expected id="Display Name", got an argument without "="`);
    const passcode = generatePasscode();
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const hash = await hashPasscode(passcode, salt);
    issued.push({
      credential: {
        id: arg.slice(0, eq).trim(),
        displayName: arg.slice(eq + 1).trim(),
        scryptHash: hash.toString("base64url"),
        salt: salt.toString("base64url"),
      },
      passcode,
    });
  }

  const credentials = issued.map((i) => i.credential);
  // Compact form unless a display name needs JSON (":" / ";" are its separators).
  const value = credentials.some((c) => /[:;]/.test(c.displayName))
    ? JSON.stringify(credentials)
    : credentials.map((c) => `${c.id}:${c.displayName}:${c.scryptHash}:${c.salt}`).join(";");
  try {
    parseReviewers(value); // the exact validation the server applies
  } catch (err) {
    fail(`invalid reviewer list: ${err instanceof Error ? err.message : String(err)}`);
  }

  const file = path.join(process.cwd(), OUT_FILE);
  const lines = [
    "# REROUTE reviewer passcodes — PLAINTEXT. Hand each to its reviewer privately, then delete this file.",
    `# Issued ${new Date().toISOString()}. Never commit, paste into chat, or put in env vars.`,
    ...issued.map((i) => `${i.credential.id}\t${i.credential.displayName}\t${i.passcode}`),
    "",
  ];
  await writeFile(file, lines.join("\n"), { mode: 0o600 });
  await chmod(file, 0o600); // `mode` applies only on creation
  console.error(`Wrote ${issued.length} passcode(s) to ${OUT_FILE} (mode 600). Set this env var (no plaintext inside):`);
  console.error("(.env files: use the line as is; Vercel dashboard: paste the value without the outer quotes)");
  const quoted = value.startsWith("[") ? `'${value}'` : `"${value}"`;
  console.log(`REROUTE_REVIEWERS=${quoted}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
