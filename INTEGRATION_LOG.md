# PULSE × REROUTE integration log

Branch `hackathon-integration` (worktree `../hackathon-repo-integration`), based on `origin/main@1271e53`.
No remote push, no shared-main merge, no shared-Supabase migration without explicit approval.

## Preserved refs

| Ref | Commit | Content |
|---|---|---|
| `backup/origin-main-1271e53` | `1271e53` | Remote main at integration start (CLEAR schema, agreement generator, compliance flags, stories) |
| `backup/main-45dab7a` | `45dab7a` | Local main: 2 unpushed REROUTE Supabase commits (`c8444e9`, `45dab7a`) |
| `backup/pulse-local-a994a65` | `a994a65` | PULSE work, previously uncommitted, committed on `pulse-local` after a secrets/footage check |

`main` and `pulse-local` were left at their own heads. The `merlin` remote (a fork with an unrelated root) was fetched only.
`score_play_api_doc.json` stays untracked in the main checkout; it is a vendor doc used as reference.

## Integration steps

1. `git worktree add -b hackathon-integration ../hackathon-repo-integration origin/main` (upstream unset so a bare `git push` cannot target main).
2. `git merge --no-ff pulse-local`: clean. `origin/main` only changes `clear/` and docs since the common base `7400732`.
3. `git cherry-pick -x c8444e9 45dab7a`: auto-merged `reroute/{README.md,.env.example,package.json,pnpm-lock.yaml}`.
   Verified by hand: `package.json` has both `hls.js` (PULSE) and `@supabase/supabase-js` and `server-only` (local main), and `.env.example` has both the PULSE and the Supabase blocks.
   `pnpm install --frozen-lockfile` passes.

## Safety configuration (worktree-local, gitignored)

- `reroute/.env.local` was copied from the main checkout with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` **blanked**, so dev and tests cannot write to the shared project.
  The original values are kept in `reroute/.env.shared-supabase.local` (gitignored) for read-only inspection only.
- `SCOREPLAY_UPLOAD_APPROVED=false`, `MEDIA_PROCESSING_APPROVED=false`.

## Baseline after integration

- `vitest run`: 10 files, 136 tests pass.
- `tsc --noEmit` without `next typegen`: only Next-generated global types are missing (`RouteContext`, `PageProps`, `LayoutProps`). The `typecheck` script runs `next typegen` first.

## Conflict and design resolutions

(Appended as the waves land.)
