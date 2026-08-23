# PR #10 — representative state-transition matrix

Дата: 23.08.2026
Статус: рабочая матрица bounded-pass; не является решением о merge или публичной готовности Beta.

## Правило доказательств

Статус **PASS** означает свежую проверку доменной логики/сохранённого состояния и, где отмечено, фактическую ручную проверку в обычном Chrome. **PARTIAL** означает, что код и тесты покрывают переход, но видимое поведение в реальной пользовательской вкладке после текущего изменения не подтверждалось. **BLOCKED** означает отсутствие безопасного способа выполнить именно этот слой проверки, а не дефект продукта.

| Путь и переход | До → действие → после reload | Evidence | Статус |
|---|---|---|---|
| Текст до и после добавления в книгу | capture text → manual revision → сериализация → book revision | `keeps text-only edits append-only before and after the story enters the book state` | PASS |
| Смешанный ввод в четырёх порядках | text→audio; audio→text; text→audio→text; audio→text→audio → assembled story | Unit: `preserves every mixed text and audio contribution across distinct interaction orders`. Manual human Chrome 23.08.2026: text→voice→text in main capture and text→voice→text in book-state survived reload. | PASS |
| Несколько аудио и последовательные вопросы | story audio + text answer + voice answer → assembled/reloaded story | Unit: `keeps question chains and gives all story audio an unambiguous final order`. Manual human Chrome 23.08.2026: a text answer followed by a voice answer, then story added to the book. | PASS |
| Manual/improved transcript в текущем тексте | raw revision → later whole-story edit → selected manual revision | Unit: `makes a selected manual transcript visible without destroying a later whole-story edit`. Manual human Chrome 23.08.2026: corrected transcript changed visible story text, not only source materials, and survived F5. | PASS |
| Редактирование текстового и голосового ответа | saved answer → manual revision → story text/source/revision | `revises text and voice interview answers append-only with stable question and audio provenance` | PASS |
| Продолжение уже сохранённой истории голосом и текстом | saved story → one append operation → repeated operation | Unit: `appends book-state text and audio in one idempotent provenance operation`. Manual human Chrome 23.08.2026: text→voice→text worked in book-state; the new audio fragment remained after reload. | PASS |
| Название и порядок историй | fallback title → manual title revision; stored order → reader order | Unit: `derives a useful fallback title and preserves manual title revisions`; `sorts the newest confirmed story first without mutating stored order`. Manual human Chrome 23.08.2026: edited title persisted and a new story appeared at the top. | PASS |
| Повторное нажатие/конфликт дублей | repeated transcript/manual/text/archive operation | `makes repeated edits and destructive-state transitions idempotent` | PASS |
| Маршрутизация без лишнего «Рассказать» | first choice → capture; remembered prompt → inline interview | source inspection: route `method` и rendering removed; UX text updated | PASS |
| Таймер на каждом входе записи | story capture / answer / book addition → active recording | Source inspection: shared `recordingSeconds`, reset at start/stop, visible `role="timer"` in all three recorders. Manual human Chrome 23.08.2026: timer displayed during real recording. | PASS |
| Фактическая пользовательская вкладка и микрофон | visible Chrome tab → actual Start/Stop → saved source | Manual human Chrome 23.08.2026: main capture, question voice answer, book-state audio append, persistence after F5 and all listed visible transitions passed. The Codex browser bridge remained unavailable, but was not used as a substitute for evidence. | PASS |

## Explicitly not repeated in this bounded pass

The reversible audio archive/recovery path is already verified at remote head `3e3473af4bcba93590fcfa8b17f04b72b3e8082c` and is not repeated here because these bounded changes do not modify it.

## Acceptance conclusion

All in-scope code/state and user-visible browser evidence for PR #10 is complete. The Codex browser bridge may remain technically unavailable, but it is not an acceptance blocker because manual human Chrome evidence covered the outstanding transitions. Public-Beta production blockers remain separate from this PR's acceptance decision.
