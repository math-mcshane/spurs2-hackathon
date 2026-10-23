# Jury Q&A — difficult questions, honest answers

Facts cited here are in [`../demo/DEMO_EVIDENCE.md`](../demo/DEMO_EVIDENCE.md) and [`TECHNICAL.md`](TECHNICAL.md).

**1. Why don't you render the cut?**
Because the decision doesn't need the file, and rendering protected footage needs playback/processing rights the organizers haven't granted (previews are off, `MEDIA_PROCESSING_APPROVED=false`). A cut is an edit decision list — kept and removed source intervals with reasons — and the engine evaluates exactly what the cut would contain. The UI says "Edit plan — not rendered". Rendering is the club's editing tool's job; a reviewer confirms cut points on the render (the option says so).

**2. Is a "demo ALLOWED" legally valid?**
No. Every package in the app is fictional and every verdict says "Demo policy — not verified legal clearance". `canPublish()` requires an approved review under a non-fictional policy, so `publishable` is false even after approval, and the writeback refuses live writes.

**3. What if TwelveLabs misidentifies a player or a brand?**
AI output is evidence, not a fact about identity or a licence. A player's club is asserted only from the ScorePlay squad: an AI-named or number-only player who isn't matched to it ("Player #18" in the merch clip, "Richarlison", "Porro" in the sponsor clip) becomes *unknown*, and the finding says so: "Can't be matched to the club's registered squad in ScorePlay, so image rights can't be confirmed (AI identification — a reviewer must confirm)." Low-confidence observations (< 0.6) can't block on their own. Every observation is shown with its timecode and source run so a reviewer can check it. No human has verified the demo observations — we say so.

**4. Your two analysis runs disagree. Which one wins?**
Neither: the engine uses the union. In *Fans clap* the crest is 9–11 s in the product run and 9–14.5 s in the second run; the restriction is localized to 9–14.5 s, which is why the trim leaves only 1 s and is rejected. Disagreement makes PULSE more cautious, never less. Both runs are labelled in the evidence.

**5. The NBA footage isn't indexed. Doesn't that break the story?**
It shows the failure mode honestly. 65 San Antonio Spurs videos are in ScorePlay but in no TwelveLabs index our keys can see. PULSE says "not indexed" and never fills the gap with invented moments; without video evidence the engine can still decide platform/territory/usage questions and returns NEEDS_REVIEW where content matters. Indexing them is configuration (a per-club index), not code.

**6. Why not just blur the crest?**
Blurring a partner-exclusivity conflict is a creative and contractual decision (some deals forbid altering broadcast footage), and it requires rendering protected footage we're not allowed to process. We prefer options the engine can verify: cut, clean section, replacement, campaign change. A blur option could be added as another proposal, re-checked the same way — but we'd still not call it cleared.

**7. What if TwelveLabs (or ScorePlay) is down during a campaign?**
Rights checks on already analysed clips use stored observations and don't call TwelveLabs. If an upstream fails and a recording of the same request exists, the app serves it and the header tag switches to "Recorded data <date>". Otherwise it shows an unavailable state — it never invents moments or evidence. Missing analysis is never treated as "clean": it is NEEDS_REVIEW.

**8. How do we know your policies are authentic?**
They aren't — they're fictional demo packages written to exercise real rule types (licensed territories, partner exclusivity, image rights, platform rules). Uploaded packages are forced to DEMO and labelled "Uploaded rules — unverified, demo only", stored with a sha256 and the uploader (visible to reviewers only). A real deployment would have the club's rights team author or approve the package and mark it verified outside the app; until then nothing is publishable.

**9. Can you read our PDF contracts?**
Not in this build, and we don't pretend to. PDF/DOCX uploads are refused with "Contract (PDF) extraction is not supported in this build." Today rules come in as structured JSON. Extraction would be a drafting aid at best; a human would still approve the resulting package.

**10. What about fans and children in the crowd footage?**
Crowd shots are the riskiest content for privacy. The demo packages permit crowd and stadium shots in sales posts on the basis of "stadium conditions of entry" when no player is identifiable (THFC-10 in the social package) — a fictional assumption, not a privacy assessment. They have no rule for identifiable private individuals or minors; that is a gap in the demo rules, not a solved problem. Our media catalog lists footage showing a child ("Slide 4 - Dad with his boy") as needing human verification — notably it surfaced as moment 03 for the Mexico goal. A real package should add a rule for identifiable minors and private persons (deny, or require consent), and the engine would apply it like any other rule.

**11. Does it scale beyond one match?**
The engine is pure and fast (checks 0.17–0.37 s, recovery ≤ 1.6 s including a search, measured locally). Analysis is the cost driver and is done once per video and cached. Limits today: Pegasus refuses videos over 60 min (the full match has no product-run observation), and we've only exercised 58 indexed videos.

**12. What does it cost to run?**
We have not measured cost per campaign and won't quote one. The cost drivers are one Pegasus analysis per video (cached), Marengo searches per goal and per recovery, and Supabase storage of decisions (no media).

**13. What's the business model?**
Club subscription per media library with producer and reviewer seats, distributed as an add-on through ScorePlay, plus onboarding work to encode a club's real licence terms. No revenue or ROI figures — sales attribution isn't connected, and the app says so.

**14. What is real and what is simulated?**
Real: ScorePlay assets, tags, squads (read-only); TwelveLabs moments, timestamps and both analysis runs; the engine's verdicts and re-checks; reviews, receipts, the hash-chained audit trail. Fictional: all rule packages. Simulated/off: fan-signal board (off), writeback (dry run), previews (off), rendering (plans only), sales attribution (not connected). Sheet: [`EVIDENCE.md`](EVIDENCE.md).

**15. How would a club onboard its real rules?**
Workshop with the rights team → encode licensed territories, channels, partner lists, image-rights coverage and exclusivities as a rule package (JSON schema, sample `tottenham-international-window.sample.json`) → upload in the Policy Center → run the club's typical goals against it and compare with the team's own answers → only then mark it verified. Sponsor activations get their own package (as in the demo's "Commercial & Sponsor" package).

**16. Isn't "find a way" dangerous — won't it push people to publish anyway?**
Every option is re-checked by the same deterministic engine and labelled with its verdict, including the ones it rejects. Options that change the goal are marked "Changes the goal". A licence gap produces no executable option and locks review. A human still approves.

**17. Why did the merch flow pick Slide 6 over the clean section of the same clip?**
Both are allowed. Slide 6 was found by the goal's own search at #2; the clean section 0:23.5–0:30.4 matched the same search only at #9 ("Video search also matched this section to … (#9)"), so it ranks below the better-matched replacement. The choice stays with the user — and choosing the section shows the edit plan ("Edit plan — not rendered").

**18. How is this different from a MAM?**
A MAM stores and tags. PULSE starts from a business goal, decides every planned use against rules, and when the answer is no, finds and verifies the best path to the same goal. It sits on top of ScorePlay and writes decisions back to it.

**19. What happens when the rules change?**
Switch package (Policy Center or "Change rules"): the current verdict is marked out of date until re-checked. In the sponsor demo the same clip goes from Blocked (social package) to Needs review (commercial package) to Allowed after the engine finds a clean section.

**20. You rejected a cut in the merch demo. Does cutting ever work?**
Yes — when enough footage survives. On the rights desk, *solanke late goal* 0:10–0:19 for a sponsored post is blocked by a DHL board at 15–17 s (seen by the second analysis run). PULSE proposes "Remove 0:14.5–0:17.5": 6.0 of 9.0 s remain, one jump cut, and both kept pieces are re-decided ALLOWED under the demo rules. In the merch clip only 1.0 of 7.8 s would remain, below the minimum, so the cut is rejected.

**21. Is your deployment public? What can someone do with it?**
The Vercel preview is public by decision (no Deployment Protection). It exposes no footage (previews off, no media URLs in API payloads), writes nothing to ScorePlay (dry run), and every reviewer action needs a named reviewer session. Expensive routes are rate-limited per IP (recovery 10/min) — best-effort on serverless; production would add a firewall rule. Policy uploads are unavailable there until the shared database migration is approved.

