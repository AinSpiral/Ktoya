# PR #10 — representative state-transition matrix

Дата: 23.08.2026
Статус: рабочая матрица bounded-pass; не является решением о merge или публичной готовности Beta.

## Правило доказательств

Статус **PASS** означает свежую проверку доменной логики или сохранённого состояния через автоматические тесты. **PARTIAL** означает, что код и тесты покрывают переход, но видимое поведение в реальной пользовательской вкладке после текущего изменения не подтверждалось. **BLOCKED** означает отсутствие безопасного способа выполнить именно этот слой проверки, а не дефект продукта.

| Путь и переход | До → действие → после reload | Evidence | Статус |
|---|---|---|---|
| Текст до и после добавления в книгу | capture text → manual revision → сериализация → book revision | `keeps text-only edits append-only before and after the story enters the book state` | PASS |
| Смешанный ввод в четырёх порядках | text→audio; audio→text; text→audio→text; audio→text→audio → assembled story | `preserves every mixed text and audio contribution across distinct interaction orders` | PASS |
| Несколько аудио и последовательные вопросы | story audio + text answer + voice answer → assembled/reloaded story | `keeps question chains and gives all story audio an unambiguous final order` | PASS |
| Manual/improved transcript в текущем тексте | raw revision → later whole-story edit → selected manual revision | `makes a selected manual transcript visible without destroying a later whole-story edit` | PASS |
| Редактирование текстового и голосового ответа | saved answer → manual revision → story text/source/revision | `revises text and voice interview answers append-only with stable question and audio provenance` | PASS |
| Продолжение уже сохранённой истории голосом и текстом | saved story → one append operation → repeated operation | `appends book-state text and audio in one idempotent provenance operation` | PASS |
| Название и порядок историй | fallback title → manual title revision; stored order → reader order | `derives a useful fallback title and preserves manual title revisions`; `sorts the newest confirmed story first without mutating stored order` | PASS |
| Повторное нажатие/конфликт дублей | repeated transcript/manual/text/archive operation | `makes repeated edits and destructive-state transitions idempotent` | PASS |
| Маршрутизация без лишнего «Рассказать» | first choice → capture; remembered prompt → inline interview | source inspection: route `method` и rendering removed; UX text updated | PASS |
| Таймер на каждом входе записи | story capture / answer / book addition → active recording | source inspection: shared `recordingSeconds`, reset at start/stop, visible `role="timer"` in all three recorders | PARTIAL |
| Фактическая пользовательская вкладка и микрофон | visible Chrome tab → actual Start/Stop → saved source | Chrome native host currently does not expose the selected user-visible tab to automation; no hidden-tab claim is used as evidence | BLOCKED |

## Explicitly not repeated in this bounded pass

The reversible audio archive/recovery path is already verified at remote head `3e3473af4bcba93590fcfa8b17f04b72b3e8082c` and is not repeated here because these bounded changes do not modify it.

## Required final step

After the remaining non-browser implementation/documentation changes, run one integrated `test → lint → typecheck → build` regression. Any newly introduced source/state behavior must update this matrix before PR acceptance is considered.
