# Hybrid cinematic hero — original asset provenance

Date: 2026-09-05. Baseline: `110e01b6568d597f22a47b583007801e21a1240c`.
Worktree: `C:\Ktoya-life-book-hybrid`; local branch `codex/feat/life-book-hybrid-hero`.

## Scope / decision D059

Native `image_gen` was available and actually produced four original images. Selected: desktop forest, independently composed mobile forest, first walnut book. The second book was rejected because it returned a studio backdrop instead of requested alpha. No third procedural attempt was used to synthesize photographic materials. Procedural forest/book remain load fallbacks; existing capture paper treatment is unchanged. AI, recording, revisions, book composition, providers, migrations and data model are untouched.

Provenance for all masters: **original generated asset**, native image_gen built-in mode. Model, seed and configurable quality mode were not returned and are not invented. No third-party stock, hotlink, account, new API key, external paid image API or model download. Four native generation calls are distinct from external paid provider calls (zero). Original outputs remain under Codex generated_images; selected masters are additionally saved on C: below. Prompts describe desired sizes, while the manifest records actual output dimensions. No artificial upscaling.

## Asset selection and packaging

| Asset | Actual master | Production widths | Alpha |
| --- | --- | --- | --- |
| Desktop forest | 1586×992 PNG | 1200 / 1584 | no |
| Mobile forest | 1024×1536 PNG | 768 / 1024 | no |
| Walnut book | 1122×1402 PNG | 560 / 1120 | RGBA, range 0–255 |

Production files are in `apps/web/public/art/life-book/`, each width as AVIF and WebP, 12 files total. Largest individual derivative is 285,808 bytes. Selected masters total 7,542,607 bytes and are kept out of Git; production derivatives and this reproducible provenance are committed. Rejected alternatives are not committed. Resize/encode helper: `apps/web/scripts/build-hybrid-assets.py`, Pillow/LANCZOS, AVIF quality66, WebP quality83. It verifies dimensions and alpha and writes a SHA-256 manifest. It does not redraw or retouch assets.

## Coordinate contract / loading

The book's HTML cover plane is a projective homography: logical 700×1120 maps to master-pixel corners TL(240,85), TR(902,126), BR(901,1274), BL(246,1200), inside the visible walnut cover. CSS padding96 provides a scaled safe inset. Brand, subtitle, story title and caption are real HTML, not raster pixels. Existing global paragraph positioning was explicitly overridden after screenshot inspection found a tiny displaced title; a green bounds test alone was insufficient for acceptance.

Desktop negative-space copy sits on the left; book/resting root is on the right. Mobile uses a separate vertical forest, not desktop crop. Shared upper-left warm lighting, cool ambient, alpha-preserved edges and a small contact shadow integrate the book. Fine-pointer movement: background1.5px, book2.7px, sparse foreground6px maximum horizontally; no touch parallax, no book bobbing/zoom. Reduced motion disables every motion layer. No per-frame JS loop, new runtime dependency or full-scene canvas/WebGL.

Picture sources select AVIF/WebP and mobile/desktop art. Preload media queries match the forest picture sources. Images are eager/high priority, have explicit dimensions, and sit in fixed-size geometry. The delayed-image test verifies book slot and CTA boxes do not move and mobile does not fetch the desktop forest. Independent decode failures restore procedural forest/book without blocking entry. Physical-phone/iOS Safari testing and a hardware LCP benchmark are not claimed.

## SHA-256 and actual file manifest

```json
[
  {
    "name": "forest-desktop",
    "master": "C:\\Ktoya-life-book-hybrid\\apps\\web\\outputs\\hybrid-art\\masters\\forest-desktop.png",
    "dimensions": [
      1586,
      992
    ],
    "sha256": "3c2c23f741329aaecded66a258f3af2c85fd86e6438ddb0ce9f520bb03baf2ce",
    "derivatives": [
      {
        "file": "public\\art\\life-book\\forest-desktop-1200.avif",
        "dimensions": [
          1200,
          751
        ],
        "bytes": 131414,
        "sha256": "eb433c9929f419988817e740d2a550abb18b7071a33dac2e55062f295d05907e"
      },
      {
        "file": "public\\art\\life-book\\forest-desktop-1200.webp",
        "dimensions": [
          1200,
          751
        ],
        "bytes": 182728,
        "sha256": "aa0110d9f0e03f96f434d5ffbe9de3052d9f8e8295a6b3c6b3295492d4fbb7e8"
      },
      {
        "file": "public\\art\\life-book\\forest-desktop-1584.avif",
        "dimensions": [
          1584,
          991
        ],
        "bytes": 193184,
        "sha256": "5c46432e80836b11695d8d60eea09255ebade3506de55a28d62833e521953bd7"
      },
      {
        "file": "public\\art\\life-book\\forest-desktop-1584.webp",
        "dimensions": [
          1584,
          991
        ],
        "bytes": 267622,
        "sha256": "84b15e0a2e655c29f2b2924ceaf6d16ec036382fd526996a13e9be1caa60d9c7"
      }
    ]
  },
  {
    "name": "forest-mobile",
    "master": "C:\\Ktoya-life-book-hybrid\\apps\\web\\outputs\\hybrid-art\\masters\\forest-mobile.png",
    "dimensions": [
      1024,
      1536
    ],
    "sha256": "fb2907ddf2a869396d9e360f8cd0bea4c82ac9b9c006fd6555889022afa7bda7",
    "derivatives": [
      {
        "file": "public\\art\\life-book\\forest-mobile-768.avif",
        "dimensions": [
          768,
          1152
        ],
        "bytes": 106206,
        "sha256": "b7d5e8995a2be456ea6aaaf413227bda0a44a0054d456e4697bac584d43f713a"
      },
      {
        "file": "public\\art\\life-book\\forest-mobile-768.webp",
        "dimensions": [
          768,
          1152
        ],
        "bytes": 150352,
        "sha256": "6632cfebe63a00fe5d918ce65363045c045494cdf5a496b95ab7ad202301573b"
      },
      {
        "file": "public\\art\\life-book\\forest-mobile-1024.avif",
        "dimensions": [
          1024,
          1536
        ],
        "bytes": 160468,
        "sha256": "d60740c24c51c989569b858e5a5f415181acb8ab82db14b455cf03a3e320204c"
      },
      {
        "file": "public\\art\\life-book\\forest-mobile-1024.webp",
        "dimensions": [
          1024,
          1536
        ],
        "bytes": 224968,
        "sha256": "95a2975ead3d5a0e14b8938ab7e0ffa703cad33a344affc879d5a672702ebea7"
      }
    ]
  },
  {
    "name": "book",
    "master": "C:\\Ktoya-life-book-hybrid\\apps\\web\\outputs\\hybrid-art\\masters\\book.png",
    "dimensions": [
      1122,
      1402
    ],
    "sha256": "3529cbff5855fb6d700f2825f75d5758641912e6558acc305f58915ecf6dcd36",
    "derivatives": [
      {
        "file": "public\\art\\life-book\\book-560.avif",
        "dimensions": [
          560,
          700
        ],
        "bytes": 39339,
        "sha256": "ebb839beee206b12f6cc402c2cd3724ee17bef97847d45aeb595377484222138"
      },
      {
        "file": "public\\art\\life-book\\book-560.webp",
        "dimensions": [
          560,
          700
        ],
        "bytes": 79920,
        "sha256": "7f6337e8e4bf416ec10c99eead08df677bc3026523dde30fc4f7a86f38571f78"
      },
      {
        "file": "public\\art\\life-book\\book-1120.avif",
        "dimensions": [
          1120,
          1400
        ],
        "bytes": 148694,
        "sha256": "ed0cf80dbd6c11659d3bd2e576beabeb884e9cd95d125132971e8274ebdb91b3"
      },
      {
        "file": "public\\art\\life-book\\book-1120.webp",
        "dimensions": [
          1120,
          1400
        ],
        "bytes": 285808,
        "sha256": "357bb20fb04dc7232d2ecbdf37191351d00238a08cbd3645cb8069d8ff051bea"
      }
    ]
  }
]
```

## Exact native generation prompts

### A — desktop

Native original: `D:\ChatGPT\Codex\.codex\generated_images\01a02518-9034-7871-bb71-8160b0310dab\exec-1bc74d24-c246-44da-82b9-a25bf3487d3d.png`.

```text
Use case: photorealistic-natural. Original desktop forest foundation for an intimate life-memoir website. High-resolution landscape 16:10 master, desired 2560x1600. Ultra-realistic cinematic temperate deciduous forest at early golden hour, premium editorial woodland photography. Mature natural irregular trunks receding through three real depth planes, cool neutral deep-green distant shadows, restrained warm sunlight from UPPER LEFT through canopy, softly visible atmospheric perspective but no theatrical light shafts or fantasy fog. Real bark and individual leaf and moss detail, natural muted olive greens, warm walnut-brown soil. Low camera at resting-object height, 50mm natural lens perspective. A broad very low old exposed root with flat stable surface in the middle-right foreground, around x=70%, y=83%, reserved for a later separately composited upright book. The actual book will occupy x=56-86%, y=21-84%; keep that zone free from crossing branches, no actual book. Left x=7-45%, y=22-75% needs calm moderately dark low-contrast negative space for later cream HTML heading and button; do NOT render the text. Upper 12% calm for navigation. Background still convincing natural forest, not a blank green gradient, not a cleared trail. Intimate, warm, human, peaceful, timeless, alive but plausible. No people, buildings, paths, signs, books, typography, logos, letters, glowing moss, fairies, fantasy, cartoon, plastic leaves, repeated trunks, AI-mush foliage, HDR, heavy vignette, strong blur or oversaturated emerald. One complete landscape image, not collage or interface.
```

### B — mobile

Native original: `D:\ChatGPT\Codex\.codex\generated_images\01a02518-9034-7871-bb71-8160b0310dab\exec-0805d855-5e87-47aa-9ef6-28766be501f7.png`.

```text
Use case: photorealistic-natural. Original MOBILE forest background, vertical portrait composition, desired 1440x2160 high resolution. A REAL intimate temperate deciduous woodland at early golden hour, premium editorial nature photography, natural irregular mature trees layered into a deep cool olive-green distance. Warm soft sunlight from UPPER LEFT balanced by cool ambient forest shadows. Real fine bark, leaves, moss and leaf-litter texture. Strong but plausible atmospheric perspective, no fantasy haze. Central-lower area x=18-82%, y=39-78% reserved for a separately composited upright heirloom book: leave empty of crossing branches. A low broad flat exposed root/wood resting surface spanning x=17-83%, its stable top plane at y=77%, with natural moss at sides, convincing ground contact and soil below. Top x=10-90%, y=10-35% calm dark low-contrast forest for later cream HTML heading. Bottom y=84-95% subdued for later button. No actual text/button/book anywhere. Camera at low object height, level photographic perspective, restrained color grading, peaceful emotional warmth, human intimate memory, no commercial furniture styling. Original standalone portrait, NOT a crop of a landscape. No people, buildings, signs, logos, letters, books, paths, fantasy, glowing moss, magical lights, cartoon leaves, repeated trunks, AI mush, fake HDR, heavy vignette, oversaturated green, large distracting foreground branches.
```

### C — selected book

Native original: `D:\ChatGPT\Codex\.codex\generated_images\01a02518-9034-7871-bb71-8160b0310dab\exec-68b66b6e-237e-4a01-b6ff-ca1a02086370.png`.

```text
Use case: product-mockup. Create one original photorealistic asset, NOT a website screenshot: premium heirloom life book with thick handcrafted walnut wood covers, genuine irregular walnut grain with subtle pores, fibers and tonal variation, softened hand-finished beveled edges, substantial physical thickness, visible ivory cotton-paper page block with individual page-edge micro-detail, realistic spine construction with restrained dark brown leather details, tiny aged-brass corner accents and one elegant muted burgundy ribbon bookmark. Closed book standing upright on its bottom edge, in restrained three-quarter perspective, front cover facing viewer enough for a large clean central title area; left spine visible and narrow right page edge visible. Camera level with book center, use long-lens editorial product photography, verticals almost upright, no dramatic perspective. Warm soft key light from upper left, gentle cool forest fill, realistic self-shadowing and green-brown reflected ambient. Quiet timeless craftsmanship, museum-quality physical object, not a furniture catalogue. The whole object including ribbon must fit inside the frame with 8 percent transparent margin. Desired portrait master 1600x2000 or closest supported high resolution. GENUINE TRANSPARENT BACKGROUND with alpha, no printed checkerboard, no white matte or halo. No ground object. No massive shadow blob. Front cover is unadorned walnut, completely blank: NO text, letters, logo, illustration, tree engraving, symbols, border inscriptions or CTA. No fake gold, ornate fantasy, steampunk, magical glow, cartoon or plastic. Do not copy the procedural book from previous conversation images; this is a new photographic-material asset.
```

### C2 — rejected book

Native original: `D:\ChatGPT\Codex\.codex\generated_images\01a02518-9034-7871-bb71-8160b0310dab\exec-a5a6bbec-87bb-4b19-ba60-da84b2d75592.png`.

```text
Use case: product-mockup. Create one original photorealistic asset, NOT a website screenshot: premium heirloom life book with thick handcrafted walnut wood covers, genuine irregular walnut grain with subtle pores, fibers and tonal variation, softened hand-finished beveled edges, substantial physical thickness, visible ivory cotton-paper page block with individual page-edge micro-detail, realistic spine construction with restrained dark brown leather details, tiny aged-brass corner accents and one elegant muted burgundy ribbon bookmark. Closed book standing upright on its bottom edge, in restrained three-quarter perspective, front cover facing viewer enough for a large clean central title area; left spine visible and narrow right page edge visible. Camera level with book center, use long-lens editorial product photography, verticals almost upright, no dramatic perspective. Warm soft key light from upper left, gentle cool forest fill, realistic self-shadowing and green-brown reflected ambient. Quiet timeless craftsmanship, museum-quality physical object, not a furniture catalogue. The whole object including ribbon must fit inside the frame with 8 percent transparent margin. Desired portrait master 1600x2000 or closest supported high resolution. GENUINE TRANSPARENT BACKGROUND with alpha, no printed checkerboard, no white matte or halo. No ground object. No massive shadow blob. Front cover is unadorned walnut, completely blank: NO text, letters, logo, illustration, tree engraving, symbols, border inscriptions or CTA. No fake gold, ornate fantasy, steampunk, magical glow, cartoon or plastic. Do not copy the procedural book from previous conversation images; this is a new photographic-material asset. Create a SECOND independent design alternative: use calmer quarter-sawn walnut with small natural pores and subtle asymmetry, no large black knot or deep crack through the title area. Use a slightly narrower and more elegant book silhouette. Brass corners must be tiny genuinely aged dull brass, not gold. Keep a very slight side perspective and cover plain. Maintain true transparent background.
```

## Final targeted QA — 2026-09-05

Final browser run: **9 passed, 0 unexpected, 0 skipped, 0 flaky**, duration 101.708 seconds. The five viewport cases are 1600x1000, 1024x768, 768x1024, 390x844 and 360x800. Four additional cases cover reduced motion, failed image decoding at 390 and 1024, and delayed image loading at 390. The suite checks landing -> CTA -> capture -> Back -> reload, bounds/overflow, keyboard focus, pointer hit targets, touch/parallax, the real transformed cover text, image source selection and strict console/page errors. It uses an isolated local test database, blocks external origins/provider endpoints, and traps microphone access; it does not make real AI/audio provider calls or claim production voice validation.

The delayed-load case proves equal book-slot and hero-CTA rectangles before and after decoding, one mobile forest resource, and no desktop forest request on mobile. AVIF is exercised by Chromium; WebP files are encoded/decoded by the asset pipeline, not separately browser-tested in a forced AVIF-incompatible browser. These are focused checks, not a field LCP/CLS or physical-device benchmark.

During integration, screenshot inspection found inherited absolute-position/small-font cover styles; these were fixed and guarded by a regression assertion (84px logical-plane title, relative position, opacity 1, fitting text). A later assertion exposed a one-pixel line-box overflow, fixed by line-height 1.25. An ambiguous CTA locator in the added test was scoped to the hero. The final run above is after all three corrections, not the earlier incomplete runs.

Lint, TypeScript typecheck and the final production build passed. No runtime dependency or lockfile change. `git diff --check` passed. The full 139 unit / 14 general browser suite was intentionally not repeated because this delta does not change functional product logic.

Evidence directory (local, intentionally ignored by Git): `C:\Ktoya-life-book-hybrid\apps\web\outputs\hybrid-art\final` contains all five `hero-*.png`, `capture-390.png`, `capture-1024.png`, `before-after-contact-sheet.png`, and `test-results.json`. The comparison uses unchanged baseline screenshots from the old worktree and fresh final hybrid screenshots. All seven final screen captures and the comparison were visually inspected.

## Visual self-rating after direct before/after comparison

These are internal visual judgments, not independent user research or a formal security/performance certification.

| Criterion | Rating | Observation / limit |
| --- | --- | --- |
| Depth | 4/5 | Photographic trunk/ground recession, separate book and restrained foreground. |
| Material realism | 4/5 | Irregular walnut, leather spine, page block and restrained brass now read as physical materials; fine page detail is limited at mobile scale. |
| Lighting | 4/5 | Upper-left warm light and cool forest fill agree; composited contact remains less exact than a single photographed scene. |
| Detail | 4/5 | Convincing bark, moss and grain at hero size; fine cover caption is intentionally subordinate and small on 360px. |
| Warmth | 4/5 | Natural morning light, warm wood and intimate forest framing. |
| Premium feel | 4/5 | Restrained physical construction replaces illustrated ornament; not rated 5 given native source resolution and composite contact. |
| Product coherence | 4/5 | Life-book copy/CTA/cover and calm capture transition retained. |
| Readability | 4/5 | Main message and CTA are clear; tiny cover metadata is not primary navigation or essential instruction. |
| Mobile | 4/5 | Separate portrait forest, large book, usable CTA and no measured horizontal overflow at both widths. |
| Performance | 4/5 | Bounded AVIF/WebP derivatives, responsive selection/preload and reserved geometry; no field Core Web Vitals claim. |

Material realism and premium feel exceed the previous illustrative 3/5 in this self-assessment. No additional procedural-material art pass is warranted. The native generator returned a 1586x992 desktop master rather than the desired 2560x1600; derivatives are never upscaled. A future higher-resolution source could improve high-DPR large displays, but is not silently fabricated here.

## Security / release boundary

This environment exposes advisory TAC status but no formal Codex Security scan-start, draft, finalization or report tools. A new formal scan is therefore **not completed**. The old scan 7650de6c-e0da-4b39-8601-f5dc66ddeb72 covers only the baseline, never this hybrid delta. Required next formal range: 110e01b6568d597f22a47b583007801e21a1240c...NEW_HYBRID_HEAD. Use an ASCII repository with its own .git to avoid the old linked gitdir encoding problem. Do not label terminal checks or this note a formal PASS.

No push/publish/merge/ready/main changes/production migration, API key or IAM change. PR12 remains fe6ba1fe8b277d50a704f1d02c36a79a606c2edb. The original dirty worktree is untouched. Final exact commit, fresh QA, ratings, screenshots and unresolved formal gate are recorded in the living archive and handoff.
