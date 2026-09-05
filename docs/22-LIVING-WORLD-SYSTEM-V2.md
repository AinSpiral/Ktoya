# Living World v2 — one author-facing world

Status: local visual candidate, not published, not approved for release.

## Mandatory living-pages addendum — 06 September 2026

The user's critical clarification supersedes accepting a rectangular paper-colored panel on a forest backdrop. Every primary capture, interview, preview/revision, book-planning and reading surface must read as a material leaf. `living-pages.css` adds three related treatments: expressive main story leaf, calmer question/notes, and clean reading leaf. Uneven contours, fibre/grain, color variation, edge thickness and a shallow binding crease are confined to noninteractive pseudo-elements. Text is never transformed or clipped; native inputs, focus rings, recording controls and author state are preserved. Mobile retains the same material silhouette. Forced-color accessibility and print deliberately prefer clarity over decorative texture.

`paper-fibres.svg` is a small deterministic, non-representational UI texture (two tiled noise filters), not a fifth raster master, illustration, external asset or generated scene. The four approved image masters are unchanged. Compare `outputs/living-world-v2/before-living-pages/` (immutable intermediate 9d45c2e captures) to fresh `after/`; do not confuse the former with the original 23908bf baseline in `before/`.

Prior QA below describes the intermediate implementation. Fresh living-pages QA: five-width complete author journey 5/5, shell/fallback 6/6, material/focus/forced-color/print/texture-failure checks 4/4. Lint, typecheck and build passed after the final surface CSS. The 913-byte SVG is requested once; actual resource ledger and screenshots are retained. Browser viewports are Chrome emulation, not physical-device or Safari certification. Final broader regression and the exact final-commit scan are recorded in the local acceptance artifact.

Intermediate scan 365dfe42-87a4-4b07-a149-4fb9b98d4dfa completed with 0 reportable findings, all 30 changed files covered. It targets 9d45c2e only and cannot certify later changes. Its canonical documents/report/SARIF are copied to outputs/living-world-v2/security-intermediate-9d45c2e; two optional context Markdown sidecars could not be copied because filesystem access was denied, while the complete threat-model object is preserved in the copied canonical manifest. The temporary original remains on C:.

Addendum self-critique: the main surfaces now have visible material grain, a shallow binding crease, irregular contour and edge thickness, rather than only a warm fill and card shadow. Material treatment is deliberately procedural UI styling, not a photograph of a unique handmade sheet. The same contour family repeats; long comparison/revision forms remain dense. No claim of perfect physical simulation or final visual approval is made.

Branch: `codex/feat/life-book-living-world-v2`.
Immutable baseline: `23908bf937fdfd149bf36bb153825c2d5fbfa4e0`.

## Art thesis

The author enters a familiar, protected place under an old canopy. The forest is not a picture that disappears after the first CTA: the same light, deep foliage, aged wood, ivory paper and quiet brass frame the entire writing journey. The rich landing is the threshold; working screens are deliberately still and readable.

Roots suggest origin, the trunk inner support, branches possible paths, the book the author's collected life. The time cut joins the memory/ancestry section: rings retain years and three natural fissures suggest the passing moment. It is a metaphor, not a functioning clock.

## Shared system and screen coverage

`apps/web/app/living-interior.css` supplies one responsive forest, paper/fibre, wood and brass system. It covers first choice, capture, interview, AI proposal, revision, registration, book overview/composition, reader, narrative style, privacy, export, balance/roadmap/settings, feedback panel and voice-feedback dialog. The existing owner inbox remains operational/utility, with no owner data or access code in the art assets.

Four original raster masters: rich landscape hero, matching portrait hero, quiet writing forest and tree-ring time cut. The new heroes refine contact with roots, irregular paper edges, stitched leather and restrained aged-brass Tree of Life relief. All cover lettering remains real HTML: “КтоЯ”, “Не идеальная биография.”, “Живая и настоящая жизнь.” A ResizeObserver maps a 400×600 DOM plane projectively onto measured front-board corners; it neither reads nor writes author state. Cleanup disconnects the observer and load listener.

Interior panels have solid, high-contrast light surfaces rather than text directly over foliage. Recorder and AI controls retain their original semantics. The reader uses a wood binding and a paper surface; settings are calmer, without added animation. Missing artwork leaves the base green/paper colors and functional controls intact. Existing procedural hero fallback is retained.

## Asset provenance and delivery

Built-in ImageGen, not API/CLI generation. No author photos, voices, text, credentials or personal records are supplied to generation. Reference/edit targets are the existing generated v1 landscape and portrait masters only.

Final prompt set:

1. Landscape: preserve the entire existing forest composition and all book corners; refine wood pores/scuffs, irregular page block, fine leather stitching, moss/root contact shadows and green reflected light; embed a restrained, thin, tarnished brass Tree of Life medallion; leave upper/lower cover blank; no lettering, runes, fantasy glow or particles.
2. Portrait: preserve the portrait framing and book position; use the landscape result as the materials/medallion reference; same roots, bark, warm light, tactile book, clear blank cover areas and prohibitions.
3. Quiet forest: photographic ancient deciduous canopy, detailed bark/moss/root edges, atmospheric warm filtered daylight, calm dark center suitable behind opaque paper panels, compatible portrait crop; no book, people, text or fantasy.
4. Time cut: a cut branch still attached to a living old tree, convincing bark/fibres/rings/moss and exactly three dominant natural fissures meeting at one center (short ~10h, medium ~2h, thin long ~6h); no metal hands, numerals, dial or symbols; very restrained natural resin glints. One targeted revision reduces upper-arm symmetry.

Approved PNG masters and full natural-asset prompts: `apps/web/outputs/living-world-v2/masters/` and `asset-prompts.md` (local evidence, ignored by Git). Runtime derivatives are versioned in `apps/web/public/art/living-world-v2/`. The builder refuses upscaling and records master/derivative SHA-256, dimensions and bytes in `outputs/living-world-v2/asset-manifest.json`. Two sizes per master, AVIF with WebP fallback; no PNG masters delivered to users. Time cut is lazy; mobile does not preload the desktop master.

## Honest visual assessment (out of 5)

| Criterion | Rating | Qualification |
|---|---:|---|
| Whole-world coherence | 4.5 | Shared forest, paper, wood and restrained brass across the author journey. |
| Realism | 4 | Strong bark, roots and photographic depth; raster masters remain generated scenes. |
| Book integration | 4.5 | One photographed scene, measured perspective typography and physical contact. |
| Materials | 4 | Book is tactile; working-panel wood/fibre is lighter CSS treatment, not bespoke photography. |
| Tree/time readability | 4 | Tree rings and three fissures read immediately; exact short/medium/thin proportions remain imperfect. |
| Natural magic balance | 4 | Meaning comes from light, time and growth, without overt glow; resin glints are intentionally barely perceptible. |
| Interior consistency | 4.5 | All requested author-facing surfaces share the system; owner inbox remains utility. |
| Readability | 4 | Solid paper surfaces, corrected header/reader status contrast and wider answer composer. |
| Mobile | 4 | Responsive book master and real recording/revision flows; long forms still require substantial scrolling. |
| Performance | 4.5 | Four compressed masters, no new runtime package, video, WebGL or interior animation. |

These are art-direction judgments, not user acceptance. Remaining limitation: some functional sections still have the density of the existing Beta. This pass does not re-architect or simplify its product flow. The time cut is an organic metaphor, not mathematically precise clock hands. Desktop full-page captures may show browser fixed-background capture behavior below the viewport; live viewport scrolling retains the forest.

## Evidence and gates

Baseline journey at exact base: five widths (360/390/768/1024/1600), 5/5 passed before source edits. Original captures retained in `outputs/living-world-v2/before/journey/`.

Final evidence is in `outputs/living-world-v2/after/` and `outputs/living-world-v2/visual/`. It includes landing, capture/recording, AI question/proposal, reading/editing, book composition, style/privacy/export, feedback modal and image-failure fallback. `before/feedback-component-390.png` is explicitly the unchanged dialog DOM with baseline CSS restored, not a claim of a second baseline server.

Final QA and post-commit official scan evidence are recorded in the local acceptance report alongside screenshots. The formal scan must cover this exact baseline through the new commit, not reuse v1's scan ID. A scan report created after a commit is evidence about that commit and does not require amending it.

Fresh verification (05–06 September 2026): 159/159 unit; 16/16 full browser regression including >100s fake-mic and feedback/isolation; 6/6 additional world-shell/fallback checks; 10/10 visual checks. After the final book-card contrast correction, the five-width experience journey passed 5/5 again with a >=4.5 contrast assertion. Fresh lint, typecheck, build and diff-check passed. Strict browser audits found no uncaught page errors or external-origin requests in those audited journeys. The dev server emits existing vinext optimizer/multiple-renderer warnings; these are not silently reported as a warning-free framework runtime. No new package was introduced.

Raster delivery: 16 files (four masters × two sizes × two formats), 2,309,038 bytes total. Quiet-forest AVIF actually observed in the browser resource ledger: 57,847 bytes at 390px and 148,055 bytes at 1600px. These are local delivery measurements, not a Lighthouse score or real-device performance certification. The contact sheet exposed and prompted correction of inherited pale card text before commit; original before/after captures and the new regression assertion remain available.

## State and release boundaries

No API, auth, persistence/domain model, AI/STT adapter, IAM, migrations, package dependencies, hosting config, bucket/binding, remote or production code path is changed. All QA data is synthetic in local D1/R2 emulation with external providers disabled. No paid external AI/STT calls, production migrations, push, merge, ready-for-review or deployment. The original dirty checkout, baseline commit, main and existing Friends Beta deployment are preserved. The v2 candidate needs Ilya's visual decision before any publication.
