# PR #12 — AI Story Core Acceptance Matrix

Дата evidence: 04.09.2026 (повторная независимая проверка после обрыва питания)
Статус: объективный технический контур реализован и проверен; литературное качество и полезность вопросов — `PENDING USER ACCEPTANCE`.

## 1. Границы приёмки

PR #12 подключает provider-independent AI-ядро только для одной текущей истории: `ASK / READY`, сборка, «Перефразировать грамотнее», exact-match patch, явное Apply/Keep и одноуровневый append-only Undo. Alice AI LLM — временный QA-adapter. Реальные истории, существующая книга Ильи, материалы Google Drive и любые персональные данные в trial не отправлялись.

Глубокое понимание всей книги, выводы о человеке и разрешение обрабатывать реальные данные внешним LLM в этот PR не входят. Публичная Beta этим PR не объявляется готовой.

## 2. Инварианты и техническое evidence

| Проверка | Статус | Фактическое evidence |
|---|---|---|
| Provider-independent boundary | PASS | `AIProvider` разделяет `nextInterviewStep`, `assemble`, `rephrase`, `patch`; Alice и deterministic fallback реализуют один контракт. |
| Structured output | PASS | Для каждой операции используется строгая JSON Schema и повторная server-side validation; свободный ответ модели не является командой. |
| Current-story-only input | PASS | Сервер строит context только из разрешённых sources выбранного draft/story; source IDs стабильны и проверяются. |
| Source isolation в output | PASS после исправления | Реальный F выявил недопустимый provenance. Schema теперь получает dynamic exact enum source IDs текущей истории, а сервер сохраняет вторую проверку. |
| Нейтральный вопрос | PASS после исправления | Реальные B/B2 показали ложную интерпретацию «загорелся» как пожар. В B3 модель выбирала category/source/anchor, но окончательный вопрос сформирован сервером из дословной source-цитаты: без причины пожара и готового ответа. Сырой model-question не сохраняется. |
| Stable questionId | PASS | questionId создаётся приложением; category, fixed purpose, anchorQuote и relatedSourceIds сохраняются вместе с вопросом. |
| Не больше восьми вопросов | PASS | Guard проверен unit-тестом; восемь — аварийный предел, а не целевое число. |
| «Не помню» не создаёт цикл и не становится фактом книги | PASS после исправления | В D после ответа «Не помню» задаётся вопрос другой категории, его anchor снова берётся из содержательного исходника. Сам неответ сохраняется в `InterviewAnswer`/`StorySource` как provenance, но исключается из читаемого текста истории. |
| Preview before apply | PASS | Assembly/rephrase/patch сохраняются как `pending` preview; UI показывает «Сейчас / Предлагается» и требует «Применить новой версией» либо «Оставить как было». |
| Assembly provenance | PASS | Каждый сегмент реальных E/F/G связан только с существующим source текущей истории; title/text не применяются автоматически. |
| Rephrase safety | PASS после исправления | Первый G содержал посторонний token `Normally` и зафиксирован как FAIL evidence. После lexical anchor guard G v2 прошёл без новых Latin/number anchors; old/new были сохранены отдельно. Эвристика не заменяет human review. |
| Exact patch | PASS | `expectedOldText` закреплён `const` в provider schema; сервер применяет patch только при одном точном совпадении в ожидаемой base revision. Неоднозначное/устаревшее совпадение отклоняется. |
| Append-only Apply/Undo | PASS | Apply создаёт новую revision с `basedOnRevisionId`; Undo добавляет ещё одну revision с `undoesRevisionId`, не удаляет применённую версию, sources, audio, transcripts или answers. G v2: 8 revisions до Undo, 9 после, sources сохранены. |
| Idempotence | PASS | operationId резервируется до provider call; повтор сохранённого результата читает persisted preview/question, а failed/uncertain operationId не вызывает provider повторно. |
| Network ambiguity | PASS | Один ранний F остался `uncertain` с max-reservation 5,6645 ₽; тот же operationId возвращает 409 и никогда не повторяет внешний вызов. |
| Known provider/application failure | PASS после исправления | Две известные provenance-ошибки записаны `failed` с usage/cost, а не `uncertain`; новый вызов возможен только как отдельное явное действие с новым operationId. |
| Deterministic fallback | PASS | При выключенной/невалидной runtime-конфигурации или отсутствии `qa-nonpersonal-trial` используется безопасная сборка только из source text; внешнего запроса нет. |
| Privacy gate | PASS после security hardening | Alice вызывается только при валидной runtime-конфигурации, точной policy `qa-nonpersonal-trial`, loopback hostname и совпадении с защищённым `KTOYA_AI_QA_USER_ID`. Пользовательский AppState-флаг, другой user ID, production hostname, `user-content-approved`, legacy/absent policy и invalid config fail closed до provider request. |
| Additive persistence | PASS | Добавлена отдельная D1-таблица `ai_operations`; production migration не запускалась, существующие истории/revisions не переписываются. |
| Browser interaction | PASS | В обычном Chrome на новой вымышленной истории пройден путь text → один нейтральный вопрос → text answer → «Собрать сейчас» → old/new preview → Keep → exact-fragment no-op → reload → book-state. Preview сохранился после reload; история 19 появилась сверху и повторно открылась с AI-tools. |
| Browser safety states | PASS | При no-op предложении Apply disabled, Keep не меняет текст; после всех переходов browser console errors/warnings отсутствуют. Внешний trial checkbox оставался выключен, Alice requests не выполнялись. |
| Responsive UI | PASS с фактическим viewport evidence | Свежий визуальный проход выполнен на 360, 390, 768, 1024 и 1600 px. На 360/390 работает мобильная навигация и одноколоночная книга, на 768 — планшетная одноколоночная сетка, на 1024/1600 — sidebar и двух-/трёхколоночная сетка. Критические controls и текст карточек не обрезаны. |
| Полная автоматическая регрессия | PASS | Финальный цикл после исправлений: 23 test files / 101 test, ESLint, TypeScript `--noEmit`, production build и `git diff --check` — PASS. |
| Security diff review | PASS после исправления | Проверены все 30 изменённых executable/source-файлов. Найден и до финализации исправлен owner-scope дефект: привязка `revision_id` к `ai_operations` теперь требует одновременно `operation_id` и аутентифицированный `user_id`; добавлен regression test. После исправления reportable findings не осталось. Канонический terminal-scan сохранён в локальном артефакте; специализированный workbench не создал scan ID из-за ошибки декодирования кириллического Windows path, поэтому применён документированный fallback с полным parent review. |

### 2.1. Свежий браузерный regression 04.09.2026

На новом вымышленном неперсональном тексте `в субботу  я сделал макет` выполнен полный локальный deterministic-путь:

1. Первый вопрос: `Ты упомянул «в субботу я сделал макет». Что это значит для тебя?`.
2. После точного ответа `Не помню.` второй вопрос сменил категорию на `people` и сохранил anchor исходного рассказа: `Ты упомянул «в субботу я сделал макет». Чьё участие здесь важно сохранить?`.
3. Assembly old/new содержал только `в субботу я сделал макет`; `Не помню.` остался в source/provenance и не попал в читаемый текст.
4. Явный Apply создал новую revision. Rephrase предложил `В субботу я сделал макет.`; Apply изменил только форму; Undo новой revision восстановил прежний текст.
5. Reload сохранил восстановленное состояние. Exact-fragment patch показал old/new preview; Keep не изменил историю. После подтверждения история появилась первой в книге и повторно открылась в reader.
6. Browser console после прохода: 0 errors, 0 warnings.

Live microphone не проверялся без физического/виртуального синтетического устройства: это ограничение не подменено декоративной имитацией. Голосовые state machines и сохранение материалов остаются покрыты автоматическими тестами предыдущего голосового этапа; новый PR #12 не изменяет этот transport.

## 3. Реальные синтетические сценарии Alice AI LLM

Модель: `aliceai-llm`. Все тексты ниже вымышленные и неперсональные.

| Сценарий | Объективный результат | Статус |
|---|---|---|
| A — достаточно полный рассказ о бумажном кораблике | AI не повторил уже сообщённое и спросил о способе исправления порванного листа. Вопрос опирался на единственный source. Насколько этот дополнительный вопрос действительно нужен, оценивает Автор. | PASS объективно; PENDING USER 1–5 |
| B — слабый/двусмысленный рассказ о фонаре | B/B2 обнаружили недопустимое усиление «загорелся» → «возгорание». После исправления B3 показал серверный нейтральный вопрос из дословной цитаты. | PASS после исправления; PENDING USER 1–5 |
| C — 12 или 14 мая 2031 | AI явно спросил, какая дата верна, и не выбрал её самостоятельно. | PASS; PENDING USER 1–5 |
| D — ответ «Не помню» | Следующий вопрос сменил направление и не повторил первый; свежий regression дополнительно подтвердил, что `Не помню.` не используется как anchor и не попадает в читаемый текст, оставаясь в provenance. | PASS после regression fix; PENDING USER 1–5 |
| E — длинный хаотичный рассказ | Повторы сжаты в связный текст; экран, карта, спор об указателе, проверенные метки и отсутствие вывода о причине сохранены. Новых имён/дат/событий не найдено; все пять сегментов ссылаются на точный source. | PASS; PENDING USER 1–5 |
| F — «Собрать сейчас» до READY | После исправления exact source enum история собрана без интервью, с title, text и provenance единственного source. | PASS; PENDING USER 1–5 |
| G — rephrase → patch → Undo | Первый rephrase честно FAIL из-за `Normally`; guard добавлен. G v2 сохранил факты/дату/число, patch заменил только «Картонный макет» → «Макет из картона», Undo восстановил текст до patch новой revision. | PASS после исправления; PENDING USER 1–5 |

Автоматическая проверка неизвестных Latin/number anchors и заранее заданного набора фактов — защитная эвристика. Она не доказывает отсутствие всех semantic hallucinations, поэтому human preview/Apply остаётся обязательным.

## 4. IAM, тариф и бюджет

- Cloud/folder: существующие `ktoya` / `ktoya-speechkit-trial2`; новые cloud/folder не создавались.
- Billing: account `account-310`, страна RU, валюта RUB, active, привязан к cloud `ktoya`.
- Service account: `ktoya-ai-trial`, id `ajektg0rvfken7f3s77d`.
- Ровно одна роль: `ai.languageModels.user`.
- API key id `aje29pr62kau06vag431`; ровно один scope `yc.ai.foundationModels.execute`; expires `2026-08-30T19:39:09Z` (7 дней). Secret хранится DPAPI-encrypted вне Git и не приводится здесь.
- Проверенный 23.08.2026 официальный тариф синхронной Alice AI LLM в России: input 0,5 ₽ / 1000 tokens, output 1,2 ₽ / 1000 tokens.
- Реальные provider requests: 17 = 14 completed + 2 known failed + 1 uncertain; автоматических платных retries не было.
- Known usage total: 4593 input + 2184 output tokens; все операции учитываются persisted D1 budget ledger, а не client counter.
- Успешные вызовы: 3,884501 ₽; known failed: 1,032801 ₽; uncertain max reservation: 5,6645 ₽.
- Budget-accounted total: 10,581802 ₽; остаток рабочего cap 60 ₽: 49,418198 ₽. Absolute code ceiling остаётся 100 ₽ и не разрешает расход сверх 60 ₽.

Источники тарифа и технического контура: [официальные цены AI Studio](https://aistudio.yandex.ru/docs/ru/ai-studio/pricing.html), [модели генерации](https://aistudio.yandex.ru/docs/ru/ai-studio/concepts/generation/models.html), [structured output](https://aistudio.yandex.ru/docs/ru/ai-studio/operations/generation/completions-structured.html), [IAM/security](https://aistudio.yandex.ru/docs/ru/ai-studio/security/), [scoped API keys](https://yandex.cloud/ru/docs/iam/concepts/authorization/api-key).

## 5. Что остаётся до принятия

- `PENDING USER ACCEPTANCE`: оценка Ильёй качества вопросов A–D и литературного результата E–G по шкале 1–5. Объективные контракты и браузерные переходы этим не подменяются.
- Фактический браузерный QA подтвердил динамический вопрос, смену категории после «Не помню», раннюю сборку без неответа в тексте, old/new preview, Apply, Keep, exact-fragment patch, append-only Undo, reload, book-state и responsive layout. Субъективная литературная оценка остаётся за Автором.
- Public-Beta blockers из PRD не снимаются: production-quality STT, production auth/account, настоящий книжный PDF, payment/subscription/AI balance, privacy/legal readiness для реальных пользовательских данных.

PR #12 не является разрешением отправлять Alice AI реальные личные истории и не является разрешением merge или production migration.
