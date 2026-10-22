import { z } from "zod";
import { CLUBS } from "./clubs";
import type { Club, CommerceDestination, MarketCode, Product } from "./types";

const URL_SCHEMA = z.url({ protocol: /^https$/ });

/** A producer-entered destination must be https on the club's own domain (or a subdomain of it). */
export function onClubDomain(club: Club, url: string): boolean {
  if (!URL_SCHEMA.safeParse(url).success) return false;
  const host = new URL(url).hostname.toLowerCase();
  return CLUBS[club].domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Club-configured store/ticketing links: `PULSE_COMMERCE_DESTINATIONS` =
 * `club:product:market=https://…;…` (`market` may be `*`). Example:
 * `spurs:jersey:MX=https://store.example/mx/jerseys;tottenham:tickets:*=https://tickets.example`.
 * PULSE only ever links to a URL configured here or pasted by the producer — it never invents one,
 * and it knows nothing about stock or availability behind it.
 */
export function configuredDestination(
  club: Club,
  product: Product,
  kind: CommerceDestination["kind"],
  market: MarketCode | undefined,
  raw: string | undefined = process.env.PULSE_COMMERCE_DESTINATIONS,
): CommerceDestination | undefined {
  const entries = (raw ?? "")
    .split(";")
    .map((entry) => /^\s*([a-z]+):([a-z]+):([A-Z]{2}|\*)\s*=\s*(\S+)\s*$/.exec(entry))
    .flatMap((m) => (m && URL_SCHEMA.safeParse(m[4]).success ? [{ club: m[1], product: m[2], market: m[3], url: m[4] }] : []));
  const match =
    entries.find((e) => e.club === club && e.product === product && e.market === market) ??
    entries.find((e) => e.club === club && e.product === product && e.market === "*");
  return match && { kind, url: match.url, source: "CONFIGURED" };
}
