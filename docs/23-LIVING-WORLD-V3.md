# Living World v3 — art, copy, and honest story-AI boundary

Local-only candidate from `886d0758c855ead6b6f7d64cf3581e7f134fe0c0`, on `codex/feat/life-book-living-world-v3`.
No authorization to push, deploy, merge, change main, modify production, enable paid providers, or process friends' personal material externally.

## What the author should feel

“This is a quiet place that can hold my life. Outside is a real, precious book among roots; inside are its living leaves. I can speak imperfectly, change my mind, and keep ownership of every word.”

The hero uses new landscape/portrait masters with the book physically resting in the roots, shared light, depth, leather grain and aged-brass Tree of Life. Exact cover text remains HTML mapped to the photographed board, not generated lettering. The interior uses a related quieter canopy with different crops/light for writing, questioning and reading. This is one art family, not seven unrelated stock backgrounds.

Three material families use independent contours, tone, fibre scales and edge depth: expressive main story leaf; warmer, lighter question/note; clean ivory reader/book leaf. Contours affect decorative pseudo-elements only, never text, inputs or focus rings. The existing functional form controls stay recognisable. Mobile backgrounds scroll with the page. Forced-color and print intentionally remove decoration.

Landing sections have tighter widths, reduced gaps and material continuity. Primary CTA is “Рассказать первую историю”. Three organic fissures and a sapling replace abstract symbolism in the time/ancestry image. This is a time metaphor, not a working clock.

Assets: four new masters, plus one targeted time-cut edit, through built-in ImageGen. No external model API or CLI image generation. Masters/prompts/derivative SHA-256 and byte manifest live in `apps/web/outputs/living-world-v3/`. Only AVIF/WebP derivatives ship. No new package or video/WebGL layer.

## Reproduced AI root cause

1. The web client calls Friends AI endpoints. Their route forced `DeterministicAIProvider` independently of the separate Alice trial configuration.
2. That provider follows fixed question categories, joins fragments, and adjusts whitespace/case/punctuation. It does not understand meaning, importance, causal sequence or narrative style.
3. `appendInterviewDecision` previously replaced every provider question with a category template. Simply enabling an LLM would not have fixed this.
4. A manually edited fragment could still supply an older selected transcript to AI context. A failing regression reproduced this before the fix.
5. An assembly proposal had no source-snapshot check between generation and application.

The public Beta was inspected without reading or modifying its stories. It showed the older art and deterministic-mode disclosure. A direct browser navigation to public capabilities was blocked by the browser client; it was not bypassed. Local route/source and reproducible tests provide the runtime diagnosis; no claim that the public API was directly exercised is made.

## Implemented story mechanics

- Server capabilities fail closed: semantic AI is unavailable in Friends. An explicit loopback-only E2E flag enables deterministic synthetic fixtures, always disclosed as NOT semantic understanding.
- Server rejects new Friends generation with `503 semantic_ai_unavailable` outside that fixture environment; apply/keep/undo for existing proposals remain possible. Authentication, CSRF, ownership and storage checks remain in place.
- “Сохранить материалы без ИИ” keeps the existing audio/text/manual-edit path usable. It gathers material in entered order and says that no AI processing occurred.
- Fresh manual transcript corrections win over obsolete selected revisions; raw input is preserved. Context includes recognition state, author-edit flag, recording timestamp and stable fragment IDs.
- Skip disposition reaches the provider context. The prompt asks for one information-gain question or READY, respects “не помню”, does not resolve conflicting dates, and considers all fragments.
- Semantic-provider questions retain their wording only after exact source-anchor, source-ID, bounded-question and conservative lexical checks. Unrelated Russian question vocabulary is rejected rather than silently substituted. This lexical guard is deliberately restrictive, can reject legitimate paraphrases, and is NOT semantic entailment or a guarantee against hallucination.
- Assembly proposals capture source state; a changed source rejects stale application. Apply/keep/manual editing/style selection and append-only Undo retain source/version history.
- The Alice adapter sends `x-data-logging-enabled: false`; a mocked-fetch regression asserts the header. No live call was made.

## Synthetic acceptance versus live semantic acceptance

`semantic-contract.test.ts` contains authored A–L response contracts: READY/full story; three out-of-order fragments; repeats/self-correction; conflicting dates; “не помню”; skip; no unnecessary question; one grounded question; answer provenance; five style contracts; Undo; multi-audio/stale source rejection.

These verify integration and state boundaries, not that a real model can produce good output. The five style fixtures are not a literary-quality score. Existing fake-mic tests verify actual browser audio transport, not recognition accuracy. New unavailable-provider E2E records two fragments, manually saves the story, reads/reloads it and asserts zero AI requests.

Actual model acceptance of meaning, narrative coherence, emotion grounded only in the author's words, sufficiency and style remains **NOT RUN / activation gate**. The v3 candidate must not be marketed as a working semantic editor yet.

## One activation decision, before any real provider work

Proposed provider: the existing Yandex AI Studio / Alice AI LLM adapter at `https://ai.api.cloud.yandex.net/v1/chat/completions`. Do not substitute another provider silently.

Before a separately authorised evaluation: confirm the exact model/folder and regional contract, current price and grant balance/expiry, server-side hard monetary/token/request caps, no retry after uncertain billing, and current account/IAM eligibility. Start only with synthetic nonpersonal A–L material. Friends' real text needs separate clear informed consent and an explicit policy; voice bytes must not accompany LLM requests. STT is a separate data transfer and remains off.

Minimise payload to this story's selected text/transcripts, answer context, requested style/edit and stable opaque source IDs. Exclude account names/email, unrelated books, audio bytes/URLs and secrets. Verify request logging off, retention/training commitments and geographic processing terms applicable to the account before personal data. Do not infer account configuration or “free forever” from public documentation.

Official references checked during this pass:

- [Request logging](https://aistudio.yandex.ru/en/docs/ai-studio/operations/disable-logging): defaults on; documented opt-out header prevents saving request content on Yandex Cloud servers. This alone is not independent verification of account-wide retention/training terms.
- [AI Studio pricing](https://aistudio.yandex.ru/en/docs/ai-studio/pricing): input/output tokens are charged, rates depend on model/mode and contracting entity. Alice AI LLM synchronous table displays USD 0.00409836 / 0.009836064 per 1,000 input/output tokens excluding VAT; not a quotation for this user's Russian account.
- [Trial conditions](https://yandex.cloud/en/docs/getting-started/free-trial/concepts/quickstart): limited duration/grant, not permanent free inference. No live billing/grant check or new resource was performed in this art pass.

## Evidence and acceptance

V2 reference: `outputs/living-world-v3/before`, copied before v3 integration; fresh v2 390/1024/1600 baseline 3/3. V3 screenshots and resource evidence: `outputs/living-world-v3/after`. Existing v2 evidence is not relabelled as v3.

The first v3 mobile test caught intrinsic sizing of the tree-clock figure forcing overflow; the figure is now constrained and its image decoupled from grid min-content sizing. Visual review also caught fibre-tile letterboxing causing bands; square texture tiles remove it. Duplicate question-purpose copy was removed.

Final test results, screenshot contact sheet, measured resource sizes and the exact post-commit official Security Diff Scan are recorded in `outputs/living-world-v3/acceptance.md`. Do not use the v2 security scan to certify v3. Physical-device/Safari verification and live LLM/STT acceptance are not covered by Chrome viewport emulation.
