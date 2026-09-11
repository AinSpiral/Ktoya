# Living World art-direction pass

Status: local candidate, not published and not merged.

Branch: `codex/feat/life-book-living-world`.

Base: Friends Beta commit `2faac9390671da21a010ab5a2a8f423e01c166a3`.

## 1. Intended feeling

The first screen should feel like a place the author discovers inside a familiar forest: quiet, protected, materially real and old enough to hold memory. It is not a landing page that advertises a book. It is the threshold into the author's own living book.

The book is an inherited, tactile object resting in the roots of a real tree. Roots carry origin and family. The trunk gives support. Branches and filtered light imply diverging life paths and continuing growth. The editorial sections below the forest become calm book pages rather than a second competing spectacle.

## 2. What changed

- Replaced the separate forest-plus-book composition with one unified photographed hero scene so contact shadow, bark, moss, wood, page block and ambient light share one physical reality.
- Added independent desktop and mobile masters. Mobile is a purpose-built vertical composition, not a desktop crop.
- Kept the product title, CTA and cover lettering as real HTML. The generated masters contain no words or logos.
- Simplified the cover hierarchy to `КтоЯ / Книга жизни / Истории, которые важно сохранить`, with responsive typography and a bounded perspective plane.
- Preserved the procedural forest and procedural book as a no-network/decode fallback. They disappear only after the matching raster is decoded.
- Added a supporting roots-and-growth-rings image to the family section and rebuilt the lower landing as a restrained editorial sequence with paper, dark-green material panels and a single warm-metal accent.
- Added responsive art assertions for six widths, raster failure, geometry reservation, reduced motion, CTA focus/hover, transition/reload and forbidden external requests.

## 3. Original assets and provenance

All three masters were created specifically for KTOYA with the built-in image-generation capability. No stock asset, external image API, API key or paid provider call was used. The generation briefs explicitly required photoreal natural materials, blank covers, no text, no logo, no people, no neon, no fantasy particles and no generic AI-gradient styling.

| Master | Role | Native size | SHA-256 |
|---|---|---:|---|
| `hero-desktop.png` | unified horizontal forest/book scene | 1586×992 | `9237117153c17bd4bd3ee77d64ccd21426932c6d7e591893a418a4a9b3fcd27d` |
| `hero-mobile.png` | independent vertical forest/book scene | 1024×1536 | `d7461897053dfd3c86005131af37d1c3983000795ac967b201b7b6ba4a6fa8ac` |
| `ancestry-roots.png` | roots/growth-rings editorial scene | 1448×1086 | `5ae16e7ff48276960a2de4b2daf7fe3d885e0a0ba0af844fa5c383d6e4dd6292` |

The ignored masters live in `apps/web/outputs/living-world/masters`. `apps/web/scripts/build-living-world-assets.py` deterministically produces the committed AVIF/WebP derivatives in `apps/web/public/art/living-world`:

- desktop hero: 1200 and 1584 px;
- mobile hero: 768 and 1024 px;
- ancestry image: 640 and 1200 px.

The browser receives only the matching derivative. Masters are never requested. The largest shipped AVIF is 231,384 bytes; the mobile 768 AVIF is 116,642 bytes.

## 4. Composition and fallback contract

`LivingWorldBackdrop` uses a responsive `<picture>` with separate mobile and desktop sources, eager loading and a matching preload. The old `ForestBackdrop` stays mounted underneath. `data-ready=true` is set only after decode/load succeeds; until then the procedural scene remains visible.

`LivingBookArtwork` preserves the previous procedural book underneath the real scene. Its HTML cover plane is decorative and pointer-transparent. The complete cover plane and each child label are checked against clipping and overflow at every test width.

The supporting ancestry image is lazy-loaded below the fold. Its caption connects the literal material to the product symbolism without adding a false feature promise.

## 5. Visual QA evidence

Automated viewports: 360×800, 390×844, 440×956, 768×1024, 1024×768 and 1600×1000.

The pass checks:

- no horizontal overflow, including after live viewport changes;
- correct desktop/mobile source selection and no PNG-master delivery;
- cover-copy bounds;
- CTA visibility, hit testing, hover and keyboard focus;
- `landing → first choice → capture → reload → back → landing → reload`;
- no microphone, AI, voice-provider, media-provider or external-origin request during the visual journey;
- procedural fallback after deliberately corrupted raster responses;
- reserved art geometry and stable CTA position while images load;
- disabled decorative movement and zero parallax under reduced motion.

Screenshots and JSON results are intentionally ignored build evidence under `apps/web/outputs/living-world/final`.

## 6. Self-critique

What is materially stronger:

- the hero now reads as one real place rather than a good book cut-out over a forest;
- bark, roots, moss, wood and brass create tactile credibility;
- the mobile composition has its own photographic logic;
- the first CTA remains immediate and the cover message remains readable;
- the lower page has a coherent paper-and-forest rhythm instead of disconnected beige cards.

What still falls short of an ideal campaign-grade master:

- the 1586 px desktop master is sufficient for the tested 1600 px layout but is not a true 2× retina source for very large displays;
- the cover lettering is an HTML perspective overlay, so it cannot reproduce true engraved displacement and light interaction as perfectly as a hand-composited 3D render;
- the hero is intentionally calm and dark. A future photographic production could add more controlled atmospheric depth and a unique real-world prop while retaining the current readability;
- the Friends Beta session controls remain a functional shell above the art direction and are not redesigned in this pass.

These limits do not invalidate the candidate. They define the next art-production step if the direction is accepted.

## 7. State and release boundary

This pass changes landing visuals, responsive visual tests and original image assets only. It does not change story capture, book composition, feedback storage, Friends Beta auth, D1/R2 bindings, AI/STT/TTS logic, provider budgets or production data. It performs no deployment, migration, merge or push.
