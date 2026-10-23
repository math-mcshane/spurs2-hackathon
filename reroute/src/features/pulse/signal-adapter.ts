import fixtureJson from "./fixtures/signals.json";
import briefsJson from "./fixtures/sponsor-briefs.json";
import { CLUBS } from "./clubs";
import {
  SignalFixtureSchema,
  SponsorBriefSchema,
  type Confidence,
  type FanSignal,
  type SignalFixture,
  type SponsorBrief,
  type StoredManualTrigger,
  type Topic,
} from "./types";

/** A signal plus the editorial framing it is about. */
export type TopicSignal = { topic: Topic; signal: FanSignal };

/** Bundled fixtures, validated at module load so a malformed fixture fails fast. */
export const SIGNAL_FIXTURE: SignalFixture = SignalFixtureSchema.parse(fixtureJson);
export const SPONSOR_BRIEFS: readonly SponsorBrief[] = SponsorBriefSchema.array().parse(briefsJson);

/** Sample-size based, deliberately conservative: a handful of posts is never HIGH. */
export function confidenceFor(sampleCount: number): Confidence {
  if (sampleCount >= 4) return "HIGH";
  if (sampleCount >= 2) return "MEDIUM";
  return "LOW";
}

/** Groups demo replay posts by topic. Topics without posts produce no signal. */
export function fixtureSignals(fixture: SignalFixture = SIGNAL_FIXTURE): TopicSignal[] {
  return fixture.topics.flatMap((topic) => {
    const posts = fixture.posts
      .filter((p) => p.topic === topic.key)
      .toSorted((a, b) => a.postedAt.localeCompare(b.postedAt));
    const last = posts.at(-1);
    if (!last) return [];
    const signal: FanSignal = {
      id: `sig-${topic.key}`,
      club: topic.club,
      topic: topic.key,
      source: "fixture",
      mode: "FIXTURE",
      observedAt: last.postedAt,
      sampleCount: posts.length,
      samples: posts.map((p) => ({ id: p.id, text: p.text, postedAt: p.postedAt, platformLabel: "Simulated post" })),
      confidence: confidenceFor(posts.length),
    };
    return [{ topic, signal }];
  });
}

/** A producer-typed trigger: editorial input, not fan evidence (sample count 0, confidence LOW). */
export function manualSignal(trigger: StoredManualTrigger): TopicSignal {
  const key = `manual-${trigger.id}`;
  const topic: Topic = {
    key,
    club: trigger.club,
    game: `${CLUBS[trigger.club].label} · producer-selected`,
    focus: trigger.text,
    headline: trigger.text,
    angle: "Producer-entered editorial trigger; no fan-signal evidence attached.",
    interestSummary: "Entered manually by a producer — not derived from fan posts.",
    cohort: `Fans following ${CLUBS[trigger.club].label} (producer-defined)`,
    desiredFormat: "vertical_short",
    // A producer-entered player/team/filename word: resolved via ScorePlay tag search and filename match.
    scoreplay: { terms: trigger.mediaQuery ? [trigger.mediaQuery] : [], filenameHints: trigger.mediaQuery ? [trigger.mediaQuery] : [] },
    semanticQuery: trigger.text,
    topicTags: [],
    contentTraits: [],
    hooks: {},
    sponsorBriefId: trigger.sponsorBriefId,
  };
  const signal: FanSignal = {
    id: `sig-${key}`,
    club: trigger.club,
    topic: key,
    source: "manual",
    mode: "MANUAL",
    observedAt: trigger.createdAt,
    sampleCount: 0,
    samples: [{ id: trigger.id, text: trigger.text, postedAt: trigger.createdAt, platformLabel: "Producer note" }],
    confidence: "LOW",
  };
  return { topic, signal };
}
