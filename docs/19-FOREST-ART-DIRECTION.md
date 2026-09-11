# Stage B — Forest art direction, 05.09.2026

## Scope and acceptance boundary

Starting revision: `f6b9f8274f114b36b0567eaa5ee657ec7a1df642`.
Local branch: `codex/feat/life-book-experience`. No publication or release authorization.
This pass covers landing/hero, the closed book and the paper/forest transition to capture.
It does not redesign book composition, reader, settings, AI or voice processing.

Two meaningful art passes were performed. Technical verification is separate from artistic
acceptance: material realism and premium feel remain **3/5**, below the requested **4/5**.
The result is a more detailed original illustration, not yet the requested level of
cinematic forest and premium product photography. Do not mark high-end art acceptance done.
Further art iterations require a new scope; no third art pass is included here.

## Concrete before / after

| Before | Mechanism now |
| --- | --- |
| Pale landing with a contained, flat forest silhouette | Full-width scene: cooler distant crowns/trunks, stronger middle trunks, close bark/leaf branches and foreground wood/roots/moss |
| Straight brown cover with little visible construction | Slight three-quarter perspective, separate cover/back board, shaded spine and raised bands, cream page block, cover thickness, bevel and cast/contact shadows |
| Relatively uniform brown material | Deterministic SVG fibres, irregular long grain and knots, restrained warm key light against cooler ambient forest |
| Simple cover mark | Fine tree engraving with individual roots/leaves, engraved mixed-case КтоЯ, small aged-brass corners, ribbon |
| Same desktop scene scaled down | Mobile single-column composition: headline → supporting copy → large book → thumb-size CTA; close foliage and air particles removed |
| Minimal connection to capture | Warm paper, forest border and quiet green controls retained; editor remains deliberately simpler |

The second pass softened overly geometric branches, replaced chunky moss with fine tufts,
darkened the walnut and corrected the foreground width. Final support and nature still read
as illustration; the material/lighting limitation above is intentional honest reporting.

## Original assets and performance

All new art is authored procedural SVG/CSS in `forest-scene.tsx`, `life-book-artwork.tsx`
and `forest-hero.css`. There are no external images, hotlinks, purchased assets, generated
image-provider calls or added runtime dependencies. The existing project fonts are reused.
SVG gradients describe illumination/air/material, while actual trunks, branches, leaves and
roots provide the scene geometry. No WebGL, canvas loop or continuous JavaScript frame loop.

Leaves use independent 17/21-second transform cycles (±0.7°), light a 23-second opacity cycle
(0.65–0.72), and five small air particles. Mouse coordinates are clamped: far ≤1.5px,
middle ≤3.3px, near ≤6px horizontally. Touch does not activate pointer parallax.
Reduced motion disables animated layers and parallax. Decoration is aria-hidden and
pointer-inert; text and controls remain HTML. Performance rating is qualitative, not a
real-device benchmark or a new Lighthouse score.

The three art source files total 31,455 bytes before compression, including TypeScript/CSS;
there are no new raster downloads. Screenshots deliberately include the verified keyboard
focus ring; it is not a permanently visible border in normal pointer use.

## Self-rating (1–5)

These are internal visual judgments from static screenshots, not measured usability scores.
Desktop includes 1024 and 1600; mobile includes 360 and 390. No score of 5 is claimed.

| Criterion | Pass 1 desktop / tablet / mobile | Final desktop | Final tablet | Final mobile |
| --- | --- | --- | --- | --- |
| Depth | 4 / 4 / 3 | 4 | 4 | 4 |
| Material realism | 3 / 3 / 3 | 3 | 3 | 3 |
| Lighting | 3 / 3 / 3 | 4 | 4 | 3 |
| Detail | 3 / 3 / 3 | 4 | 4 | 3 |
| Warmth | 3 / 3 / 3 | 4 | 4 | 4 |
| Premium feel | 3 / 3 / 3 | 3 | 3 | 3 |
| Product coherence | 4 / 4 / 4 | 4 | 4 | 4 |
| Readability | 4 / 3 / 3 | 4 | 4 | 4 |
| Mobile composition | N/A / N/A / 3 | N/A | N/A | 4 |
| Performance | 4 / 4 / 4 | 4 | 4 | 4 |

## Narrow navigation regression

Targeted QA found an existing history guard that suppressed *every* return to landing,
not only the hydration-time placeholder. The screen showed landing but the URL retained
`#first-choice`; reload therefore reopened first-choice. The guard now protects only the
not-yet-loaded initialization. No storage/provider/editor logic changed.

Regression evidence must include both directions: capture deep-link reload stays capture;
capture → Back → first-choice → Back → landing updates the URL to `#landing`, and reload
stays landing. This is covered at all five widths by the new targeted suite.

## Verification and evidence

Fresh final result: **6/6 targeted browser tests passed in 54.8 seconds**; strict runtime
audit passed. ESLint, TypeScript and production build passed after the navigation fix.
`git diff --check` passed. Build emits the existing vinext static route-classification note;
it is not a failed build. The full 139-unit/14-browser baseline was not rerun.

Run from `apps/web`:

```text
pnpm exec playwright test --config playwright.visual.config.ts
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Six targeted browser tests cover five exact viewports (360×800, 390×844, 768×1024,
1024×768, 1600×1000) and reduced motion. Assertions include document width, heading glyph
and box bounds, book scene bounds, caption containment and transformed safe insets ≥18px
(local design padding 21–38px), keyboard-visible focus, CTA hit targets, no control overlap,
hover, bounded mouse parallax, no touch parallax, resize, capture, Back and reload.

The fixture uses installed Chrome and a separate localhost:3101 server with external
providers disabled. Empty synthetic accounts are seeded in isolated local D1 so the
intentional missing-state GET 404 does not obscure a strict zero-console-error audit.
No console errors are filtered. AI/voice/media operations and external origins are blocked;
microphone and speech recognition are disabled. No real author data is used.

Earlier test setup failures were: missing bundled Chromium (use installed Chrome), a
wrong textbox label (actual label: Твоя история), missing-state 404 on unseeded new accounts.
Actual UI failures corrected: decorative horizontal overflow, mobile word joining,
too-small serif line box, and the landing/history guard described above.

Generated evidence is deliberately not committed:
`apps/web/outputs/forest-art/final/hero-{360,390,768,1024,1600}.png`,
`capture-{390,1024}.png`, `contact-sheet.png`, and `test-results.json`.
The original 1600 screenshot is in `outputs/forest-art/before/hero-1600.png`;
the first and second composition reviews are in `pass-1/` and `pass-2/`.
All are local C: paths under the Stage B worktree. Raw screenshots preserve exact viewport
sizes; the contact sheet is only a scaled comparison.

The final handoff and living chat archive carry the exact committed SHA, fresh command
results and new formal Security Diff Scan ID/report. The prior Stage B formal PASS does not
cover this change. New security scope is precisely starting revision → new local commit.

## Safety

PR12 and the original dirty worktree remain outside the change set. The local `main` ref
and `origin/main` are not interchangeable: the observed local ref is
`0aa1f58f8da9ded744eef8e602a9085c1ba22b4d`; the provided canonical base/`origin/main` is
`d2020a6277ef31af115175ec0b835de189aa0423`. Neither is updated by this pass.
No push, merge, production migration, IAM/key change or paid provider operation is authorized.
