# CLEAR — Fan content. Rights ready.

CLEAR is a hackathon-ready UGC licensing and compliance workflow for sports teams. It turns a fan clip into a documented, searchable, decision-ready media asset: creator identity → ownership attestation → scoped micro-license → consent record → video signals → rights verdict → ScorePlay-ready metadata.

> **Hackathon assumption:** all records, video analysis, hashes, uploads, and vendor calls in this build are deterministic demo data. No real ScorePlay or TwelveLabs endpoint is assumed or called. Legal language is a product prototype, not legal advice; approved club counsel language should replace it before production.

## Oct 22 discovery incorporated

The Integrations screen reflects the two Granola notes captured on Oct 22, 2026. These are product-discovery inputs, not verified vendor documentation:

- Model the sports media hierarchy as `Collection → Media → Version → File` so a rights decision can follow the canonical media while retaining version/rendition traceability.
- Represent enrichment as media-level tags plus timestamped logs; preserve capture timecodes that correlate broadcast, imagery, and raw footage.
- Treat facial/logo recognition, transcripts, scene descriptions, emotion and other AI outputs as evidence for search and policy evaluation—not as legal conclusions.
- Keep TwelveLabs behind one adapter while allowing distinct Marengo indexing, Pegasus structured analysis, and optional Jockey operator-search implementations.
- Record model/index versions because embedding upgrades may require re-indexing.
- Preserve a human-editor checkpoint and route ambiguity—music, minors, NDAs, territory, profanity, or third-party rights—to `REVIEW`.
- Respect the hackathon&apos;s no-download constraint: production design should analyze rights-holder content in place.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the printed local URL. Run the safety evaluations separately:

```bash
npm run test:evaluations
npm run build
```

Copy `.env.example` to `.env.local` only when preparing integrations. Mock mode works without credentials.

## Supabase database

The production-shaped schema lives in `supabase/migrations/20261022133000_clear_initial_schema.sql`. It models creators, assets, ownership attestations, scoped licenses, append-only consent/audit events, video analysis, timecoded evidence, publication requests, deterministic rights decisions, review tasks, compliant asset matches, and integration events.

All tables have Row Level Security enabled and no broad client policies by default. Until role-specific policies are approved, write through a trusted server using `SUPABASE_SERVICE_ROLE_KEY`; never expose that key in browser code. The public project URL and anonymous key use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## What is implemented

- Responsive producer library with search and status filtering.
- Agentic Rights Review workspace with request context, a review queue, timecoded AI evidence, rule-by-rule findings, deterministic decisions, reviewer actions, and compliant duplicate suggestions.
- Three demo scenarios: clearable celebration, music/minor review, and expired/restricted block.
- Asset detail with verdict, reasoning, AI signals, license scope, creator proof, consent ID, expiry, and audit hash.
- Four-step mobile creator flow: upload placeholder, identity/contact, ownership attestation, granular scope, plain-English micro-license, and acceptance.
- Pure deterministic policy engine with fail-safe `CLEARED`, `REVIEW`, and `BLOCKED` outcomes.
- ProofRail-inspired evaluation screen plus executable adversarial test harness.
- Versioned draft NBA rule-pack evaluator that blocks hard failures, routes missing/ambiguous evidence to review, and requires citations for non-pass findings.
- Typed ScorePlay and TwelveLabs interfaces, mock adapters, and environment contract.

## Architecture

```text
Creator portal
  └─ submission + attestation + requested license scope
      └─ versioned micro-license + acceptance event
          ├─ append-only audit record (demo hash)
          ├─ VideoAnalysisAdapter → TwelveLabs mock signals
          └─ deterministic policy engine
               ├─ CLEARED → eligible for ScorePlay writeback
               ├─ REVIEW  → human rights review
               └─ BLOCKED → renewal/correction required

Producer workspace
  └─ searchable assets + decision evidence + expiry
      └─ ScorePlayAdapter → asset ingest / rights metadata writeback
```

The policy engine is intentionally separate from AI analysis. AI can surface signals and route review; it cannot silently expand a creator's granted scope.

## Core data model

| Entity | Key fields |
| --- | --- |
| Creator | `id`, legal name, contact, social handle, identity verification state |
| Asset | `id`, source reference, filename, creator ID, timestamps, analysis reference |
| Ownership attestation | asset ID, statement version, accepted timestamp, actor, evidence |
| License | asset ID, template/version, platforms, territory, duration, organic/paid, modification, expiry |
| Consent event | immutable ID, actor, exact license payload hash, timestamp, IP/device evidence where lawful |
| Analysis | provider reference, summary, labels, music/minor/third-party signals, model/version |
| Rights decision | verdict, reason codes, policy version, evaluated timestamp, reviewer override |
| Integration event | adapter, direction, external asset ID, payload hash, outcome, retry state |

For production, store consent events and decision changes append-only. Hashing helps reveal later alteration but does not alone make a database immutable. Use durable storage, retention policy, access controls, signed event receipts, and counsel-approved evidence requirements.

## Adapter contracts

`lib/integrations.ts` defines two seams:

- `VideoAnalysisAdapter.analyze(assetRef)` returns searchable content labels and risk signals.
- `ScorePlayAdapter.ingest(asset)` accepts an asset reference and metadata; `writeRights(result)` writes the verdict, reason codes, expiry, consent record ID, and audit hash.

The included adapters return mock values. The app deliberately contains no guessed vendor routes.

### ScorePlay integration checklist

- Obtain official Connect/Open API documentation, credentials, sandbox, rate limits, and webhook expectations.
- Confirm authentication method and server-side secret handling.
- Map asset create/link behavior: binary upload vs. existing source URL/reference.
- Confirm canonical fields/taxonomy for creator, source, license scope, expiry, and custom metadata.
- Confirm how a rights verdict and reasoning should be written back and whether fields are searchable.
- Define idempotency key, retries, reconciliation, and failure/dead-letter behavior.
- Decide whether CLEAR or ScorePlay is the system of record for consent evidence.
- Validate deletion, revocation, retention, and audit export requirements.

### TwelveLabs integration checklist

- Obtain current API docs, account credentials, supported media limits, and index strategy.
- Confirm upload/import flow, asynchronous job lifecycle, webhook/polling behavior, and provider IDs.
- Map searchable labels and summaries to the CLEAR `VideoAnalysis` contract.
- Define thresholds for music, minor, visible broadcast, trademarks, and ambiguous third-party content.
- Record model/version and raw evidence needed for later human review.
- Test latency, timeouts, retries, and graceful fallback to `REVIEW`.
- Do not treat video understanding as a legal conclusion; keep rules and reviewers authoritative.

## Demo script (3–4 minutes)

1. **Problem (20 sec):** “A fan captures the moment everyone wants to post. The team can find it—but proving permission and usable scope is slow enough that the moment dies.”
2. **Creator flow (60 sec):** Open **Creator flow**. Continue with the demo clip, show identity and ownership attestation, select platforms/territory/duration, exclude paid use, allow edits, and accept the plain-English micro-license.
3. **Decision (45 sec):** The new asset opens as `CLEARED`. Point to the reason trail, AI mock signals, exact scope, consent ID, and audit hash. Emphasize that AI informs the decision; policy controls it.
4. **Agentic review (60 sec):** Open **Rights review**. Show the draft NBA rule pack, click timecoded music/minor/tunnel evidence, then switch among `CLEARED`, `REVIEW`, and `BLOCKED` cases. Point out that hard license failures override confidence and that ambiguity goes to a person.
5. **Find a usable alternative (20 sec):** Open a same-clock or sibling version from **Safer alternatives**. CLEAR tries to preserve the creative idea while replacing the unsafe asset.
6. **Integrations (30 sec):** Show typed ScorePlay/TwelveLabs adapters in mock mode and the precise facts still needed from vendor docs—no invented APIs.
7. **Evaluations (30 sec):** Show the policy harness: missing consent, expiry, platform/territory mismatch, missing citations, and ambiguous third-party rights all fail safely.

## Concise hackathon pitch

**CLEAR turns fan content into rights-ready media.** A creator uploads once, proves ownership, and grants a plain-English license with exact platform, territory, duration, paid-use, and editing terms. CLEAR preserves the consent evidence, uses video intelligence to surface risk signals, and makes a deterministic `CLEARED`, `REVIEW`, or `BLOCKED` decision. Producers get a searchable library of moments they can actually use; ScorePlay gets structured rights metadata and expiry instead of another spreadsheet. The result is more authentic fan content, published faster, with fewer rights surprises.

## Production hardening

This prototype still needs authentication and role-based access, durable asset/consent storage, real cryptographic event receipts, malware/media validation, privacy and deletion workflows, reviewer overrides with audit, notification delivery, counsel-approved licenses, accessibility/legal review, observability, and completed vendor integrations.
