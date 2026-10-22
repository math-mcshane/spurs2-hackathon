/**
 * ScorePlay media → contracts `Asset`. Pure (no I/O) so it is unit-testable.
 *
 * Rights facts come ONLY from real ScorePlay metadata. When a fact is absent, incomplete or ambiguous
 * it stays `undefined`, which the rights engine turns into NEEDS_REVIEW — never into a default value.
 */
import type { Asset, RightsFacts } from "@/lib/contracts";
import type { ScorePlayMedia, ScorePlayMediaTag, ScorePlayTagFilter } from "./schemas";
import { SCOREPLAY_TAXONOMY } from "./taxonomy";

type FactKind = keyof typeof SCOREPLAY_TAXONOMY.factTagFilters;

/** tagOptionId → fact kinds it belongs to, from `GET /tag/filters` (tag groups). */
export function indexTagFilters(filters: readonly ScorePlayTagFilter[]): Map<number, Set<FactKind>> {
  const index = new Map<number, Set<FactKind>>();
  const kinds = Object.entries(SCOREPLAY_TAXONOMY.factTagFilters) as [FactKind, readonly string[]][];
  for (const filter of filters) {
    const name = filter.name.trim().toLowerCase();
    for (const [kind, names] of kinds) {
      if (!names.includes(name)) continue;
      for (const optionId of filter.tag_options ?? []) {
        const set = index.get(optionId) ?? new Set<FactKind>();
        set.add(kind);
        index.set(optionId, set);
      }
    }
  }
  return index;
}

export function mapMediaToAsset(media: ScorePlayMedia, tagFilters: readonly ScorePlayTagFilter[]): Asset {
  const filterIndex = indexTagFilters(tagFilters);
  // Hidden tags are excluded everywhere: a hidden tag is not asserted metadata.
  const tags = (media.tags ?? []).filter((t) => !t.hidden);

  const players = uniqueNames(tags.filter((t) => positive(t.player_id)).map(playerName));
  const sponsors = uniqueNames(tags.filter((t) => positive(t.sponsor_id)).map((t) => t.sponsor?.label || t.sponsor?.name));
  const optionTags = tags.filter((t) => positive(t.tag_option_id) && !positive(t.player_id) && !positive(t.sponsor_id));
  const teams = uniqueNames(
    optionTags
      .filter((t) => t.tag_option?.type === "team" || filterIndex.get(t.tag_option_id!)?.has("team"))
      .map(optionLabel),
  );
  const competitions = uniqueNames(
    optionTags.filter((t) => filterIndex.get(t.tag_option_id!)?.has("competition")).map(optionLabel),
  );

  const facts: RightsFacts = {
    // One unambiguous value, else unknown (a match tagging both teams leaves `team` unknown).
    competition: competitions.length === 1 ? competitions[0] : undefined,
    team: teams.length === 1 ? teams[0] : undefined,
    people: completeList(players, media.player_ids),
    sponsors: completeList(sponsors, media.sponsor_ids),
    recordedAt: unixToIso(media.date),
  };

  const kind = media.type === "video" ? "video" : media.type === "photo" ? "image" : "other";
  const thumbnailUrl = media.thumbnail_url || media.files?.find((f) => f.is_thumbnail && f.url)?.url || undefined;
  const previewUrl =
    kind === "video"
      ? media.proxy_medium || media.proxy_large || media.proxy_small || media.streaming_url || undefined
      : media.files?.find((f) => f.is_compressed && f.url)?.url || thumbnailUrl;

  const displayTags = uniqueNames([
    ...tags.map((t) => (positive(t.player_id) ? playerName(t) : positive(t.sponsor_id) ? t.sponsor?.label || t.sponsor?.name : optionLabel(t))),
    ...(media.raw_tags ?? []),
  ]);

  return {
    id: String(media.ID),
    title: media.name || `ScorePlay media ${media.ID}`,
    kind,
    thumbnailUrl,
    previewUrl,
    durationSec: durationSeconds(media),
    tags: displayTags,
    facts: stripUndefined(facts),
    metadata: stripUndefined({
      scoreplayId: media.ID,
      name: media.name ?? undefined,
      description: media.description || undefined,
      type: media.type ?? undefined,
      status: media.status || undefined,
      validated: media.validated ?? undefined,
      capturedTime: media.captured_time || undefined,
      // ScorePlay-side usage/terms/windows: shown for context, NOT interpreted as rights facts.
      usage: media.usage || undefined,
      customTerms: media.custom_terms || undefined,
      accessibleFrom: unixToIso(media.accessible_from),
      accessibleUntil: unixToIso(media.accessible_until),
      event: media.event
        ? stripUndefined({
            id: media.event.ID ?? undefined,
            name: media.event.name || undefined,
            fullPath: media.event.full_path || undefined,
            leagueApiId: media.event.league_api_id || undefined,
            externalId: media.event.external_id || undefined,
          })
        : media.event_id
          ? { id: media.event_id }
          : undefined,
      teams: teams.length ? teams : undefined,
      competitions: competitions.length ? competitions : undefined,
      tagOptionIds: media.tag_option_ids ?? undefined,
      playerIds: media.player_ids ?? undefined,
      sponsorIds: media.sponsor_ids ?? undefined,
    }),
    origin: "LIVE",
  };
}

function positive(n: number | null | undefined): n is number {
  return typeof n === "number" && n > 0;
}

function playerName(t: ScorePlayMediaTag): string | undefined {
  const p = t.player;
  if (!p) return undefined;
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || undefined;
}

function optionLabel(t: ScorePlayMediaTag): string | undefined {
  return t.tag_option?.label || t.tag_option?.name || t.name || undefined;
}

function uniqueNames(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return [...seen.values()];
}

/**
 * A people/sponsor list is a fact only if it is non-empty AND accounts for every id ScorePlay lists.
 * No tags ⇒ unknown (absence of a tag does not prove absence of a person/brand).
 */
function completeList(names: string[], ids: readonly number[] | null | undefined): string[] | undefined {
  if (names.length === 0) return undefined;
  if (ids && new Set(ids).size > names.length) return undefined;
  return names;
}

function unixToIso(seconds: number | null | undefined): string | undefined {
  return positive(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

function durationSeconds(media: ScorePlayMedia): number | undefined {
  if (positive(media.duration)) return media.duration;
  if (positive(media.media_duration)) return media.media_duration / 1e9; // documented as nanoseconds
  return undefined;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
