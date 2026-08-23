# PR #11 — фактическая матрица voice acceptance

Дата: 23.08.2026
Статус: evidence ограниченного неперсонального SpeechKit trial; не является разрешением на обработку реальных историй или публичный запуск Beta.

| Контур | Проверка и evidence | Статус |
| --- | --- | --- |
| Privacy / originals | Для всех проб использовался новый явно отмеченный `qa-nonpersonal-trial`; оригинал browser WebM/Opus сохранён отдельно от derived WAV и никогда не отправлялся provider. | PASS |
| STT: короткая запись | 37,08 с; `raw` и отдельная faithful production revision сохранены. SpeechKit вернул контроль начала и конца, но почти без пунктуации. | PASS по полноте; PARTIAL по качеству |
| STT: естественный рассказ | 145,98 с; присутствуют контроль начала, середины, конца и последнее предложение. Raw остался `incomplete`, потому что Chrome не подтвердил `onend`; production revision создана отдельно и не обрезана. Есть ошибки слов и почти нет пунктуации. | PASS по полноте и сохранности; PARTIAL по качеству |
| STT: имена / даты / числа | 74,22 с; сохранены raw и production revision. SpeechKit нормализовал дату, 15:30, 742, 6, 23 и 4850; ошибся в имени и слове «поезд», пунктуация недостаточна. | PASS по полноте и числам; PARTIAL по именам/качеству |
| STT canonical layer | `literatureText: false`; production result не переписывает raw, manual или provenance. | PASS |
| TTS assets | На одном неперсональном тексте (1066 символов) созданы `marina`, `jane`, `dasha`, `julia`, `alexander`, `kirill`; после reload доступны все шесть: 1:22, 1:21, 1:18, 1:14, 1:16, 1:23. | PASS |
| TTS transport | Для каждого варианта фактически проверены start/pause; `marina` также pause → continue. Сохранённые обычные media controls работают после reload. | PASS |
| TTS human quality | Автор прослушал кандидатов и выбрал `marina`: чистая, естественная, неутомляющая; конец длинной озвучки услышан полностью, без тихого обрыва. | PASS для Beta default |
| Configurability | `marina` — validated runtime default (`KTOYA_SPEECHKIT_DEFAULT_TTS_VOICE`), а не необратимый hard-code; approved voice можно сменить без изменения старых assets. | PASS |
| Public-Beta launch | Trial относится только к QA. Для реальных пользовательских материалов по-прежнему нужны отдельные privacy/legal/retention решения; STT нуждается в дальнейшем quality benchmark до объявления качества production-grade. | BLOCKED — внешний следующий этап |

## Выбор голоса

`marina` принята как русский TTS default текущей Beta по решению Автора. Это лучший из протестированных вариантов, но не идеальный постоянный голос: следующий quality-поиск должен проверить более мягкий/нежный женский голос без потери дикции; голос Автора остаётся будущим направлением. Ни один уже созданный narration asset не удаляется и не перезаписывается этим решением.
