# PT‑02. Аудит банка Placement Test Adult

## Объём проверки

Проверена версия файлового банка A1–C1 на коммите PT‑01 `b7e6af0`. Ниже количество заданий до правок. Производные «Найди и исправь» посчитаны как самостоятельные задания, так как ученик видит другое условие и вводит другой ответ.

| Уровень | Выбор | Пропуск | Скобки | Словообразование | Трансформация | Найди и исправь | Чтение | Аудирование | Письмо | Говорение | Всего |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A1 | 91 | 38 | 16 | 2 | 8 | 42 | 4 | 4 | 6 | 6 | 217 |
| A2 | 105 | 33 | 25 | 2 | 19 | 60 | 4 | 4 | 6 | 6 | 264 |
| B1 | 126 | 30 | 31 | 8 | 22 | 69 | 4 | 4 | 6 | 6 | 306 |
| B2 | 110 | 16 | 28 | 9 | 20 | 52 | 4 | 4 | 6 | 6 | 255 |
| C1 | 108 | 16 | 20 | 10 | 21 | 48 | 4 | 4 | 6 | 6 | 243 |
| Всего | 540 | 133 | 120 | 31 | 90 | 271 | 20 | 20 | 30 | 30 | 1285 |

Отдельно сверены 108 вложенных вопросов чтения, 108 вопросов аудирования и 76 устных стимулов. Проверены условия, ключи и варианты, соответствие каталогу тем, естественность и достаточность контекста, инструкции, форматы и материалы для разбора. Аудиосценарии сверены с вопросами по тексту. Все 96 используемых MP3 читаются через ffprobe. Полной слуховой сверки каждой фонограммы с её сценарием не проводилось. Шесть записей B2 и C1 расходятся с приблизительной длительностью в метаданных более чем на 12 секунд. Эта величина используется как ориентир при озвучке.

Уровни, идентификаторы, подуровни, каталог, порядок подбора, рубрики и банк Teens сохранены. Один открытый вопрос B1 перенесён из пропуска в раскрытие скобок, чтобы ученик сам построил порядок слов. Оба формата относятся к заданиям с открытым ответом. У остальных заданий типы сохранились.

## История и сопоставление качества

Первые файлы уровней появились в `eb1091d`, `da89a4e`, `434b0d7`, `e031014` и `72e92ed`. В коммитах есть отметки о совместной работе с Claude. Это подтверждает участие в этих коммитах и дату появления записей, но не авторство текста отдельных вопросов. Происхождение поздних записей установлено по добавлению их ID в Git.

| Группа ядра | ID в текущем банке | ID с правкой по итогам аудита | Условия с технологическими маркерами до правок |
|---|---:|---:|---:|
| Первые публикации | 200 | 6 | 5 |
| Промежуточные дополнения | 458 | 52 | 2 |
| Добавления b46e41d | 256 | 21 | 21 |

Маркеры `server`, `audit trail`, `watermark`, `PDF`, `screenshot`, `files`, `Wi-Fi` и близкие слова использованы как ориентир для чтения контекстов. Само наличие технологии не считалось дефектом. Поздний коммит добавил больше открытых форматов и тем. При этом в новом наборе чаще встречались технические контексты и разборы, повторяющие весь раздел вместо одного вопроса. В ранних блоках лучше работали короткие естественные сценарии с одной задачей и понятной причиной выбора ответа. Встречались и ранние многозначные дистракторы, например `hard evidence` рядом со `strong evidence`.

Сложность C1 сохранена семантикой и синтаксисом. Например, Past Perfect Passive остался в `G-C1-120`, а вместо отказа сервера используется закрытие театра.

## Разбор обязательных случаев из PR №6

| ID | Исходные варианты | Вывод | Правка |
|---|---|---|---|
| F-G-B1-138 | didn't check, did not check | Грамматичные, но выражают факт вместо сожаления или упущенной возможности. Исходное checked также создавало противоречие в сюжете. | Видимое требование modal perfect. Исходная ошибка теперь should had checked. |
| F-G-B1-139 | went, probably went | Грамматичное утверждение или предположение без модального перфекта. | Видимое требование modal perfect для предположения о прошлом. Сохранены might, may и could have gone. |
| F-G-B1-142 | are flying, will fly | Оба варианта грамматичны. Они не проверяют Future Continuous. | В инструкции назван Future Continuous. Приняты will still be flying и will be still flying. |
| F-G-B1-143 | am interviewing | Грамматичное описание договорённости без требуемой формы. | В инструкции назван Future Continuous. Две позиции still допустимы. |
| F-G-B1-150 | were planning to eat, had planned to eat, wanted to eat, meant to eat | Грамматичные варианты с разными оттенками плана или желания. Исходное ate плохо согласовалось с развязкой. | Видимое требование прошедшей формы be going to. Ошибка перенесена в согласование We was going to eat. |
| F-G-B1-151 | was planning to cycle, had planned to cycle, meant to cycle, wanted to cycle | Грамматичные варианты плана или желания. Исходное cycled описывало поездку, которой не было. | Видимое требование прошедшей формы be going to. Ошибка перенесена в согласование I were going to cycle. |
| F-G-C1-16 | was taking | Неверное согласование с we и несоответствие Past Simple. Форма take встречается в американском употреблении. | В условии используется перфект как неправильный вариант. Видимая инструкция требует Past Simple, ключ took. |
| F-G-C1-23 | ’d become | Сокращению не к чему естественно присоединиться после даты 2010. | Требуется полная форма. Would become, was to become и was going to become допустимы. |

Все 16 исключённых вариантов разобраны выше. Они исключены из новых ключей, а регрессии PT‑01 по старым снимкам сохранены. Для семи вопросов, на которые уже действуют ограничения PT‑01, уточнение видно и в активной попытке со старым снимком. Чтение опубликованного результата по-прежнему использует сохранённую оценку.

## Возможное влияние на историю

**A.** По снимку и точному сохранённому ответу можно проверить конкретную форму или подтверждённую альтернативу. Например, `that` допустимо в `F-G-A2-110`, `whether` — в `F-G-B1-72`, а `have` — в `F-G-B2-66`.

**B.** Старый снимок или инструкция не позволяют надёжно определить уровень владения целевой формой. Сюда входят задания с двумя разумными прочтениями, неверной предпосылкой и проверкой другой темы. Допустимость отдельной фразы можно установить, но её нельзя автоматически превращать в доказательство владения исходным навыком.

**C.** Улучшены стиль, точность объяснения, жанр памятки или контекст. Старый балл по проверяемому навыку остаётся обоснованным.

Класс у каждой записи приведён в реестре. Если у ID несколько проблем, в реестре стоит более осторожный класс. Например, у F-G-C1-16 форму was taking можно проверить по сохранённому тексту (A), но исходный вопрос с take методически неоднозначен (B). Для Fix до PT‑01 известны только одно нажатое слово, текст и сохранённый балл. Вторую границу и следующий вопрос при иной оценке восстановить нельзя. Кроме того, сохранённые правки банка в production могут отличаться от Git. Аудит охватывает файловый банк и синтетические сценарии. Фактические попытки конкретных учеников, production-правки `PlacementEdit` и охват исторических случаев не проверялись.

## Открытые решения

- Согласовать, в каких заданиях целевая форма должна быть названа, а в каких темах допускаются равнозначные конструкции и варианты регистра. Для будущих правок это особенно важно в блоках модальности и будущего в прошлом.
- Согласовать правила аудита и возможного пересчёта A/B с Tech Lead и Roadmap & Progress. Отдельно определить, как поступать с недостаточными снимками, прежней видимостью отчёта и Checkpoint.
- Сверить фактические правки владельца банка с новыми файлами до решения о выпуске. Оценить замечания по распределению заданий в темах отдельно от исправлений содержания, так как они влияют на покрытие диагностики.

## Проверки

- Проверка формата банка показала 0 ошибок. Осталось 137 замечаний Adult. Среди них стабильные ID у заданий, перенесённых между уровнями, и эвристические предупреждения по разборам и частоте тем. Банк Teens дал 0 ошибок и 21 замечание.
- Регрессия Placement проверила все 914 заданий ядра, 271 производное задание и 347 объявленных вариантов Fix. Отдельно проверены 16 исключений на старых снимках, обе схемы записи ответа, работа с диапазоном и допустимые альтернативы. Проверки обратной связи, переоценки и типизации прошли. Симуляции Adult и Teens завершились.
- В Chromium на отдельной PostgreSQL с синтетическими данными проверены новая инструкция при выборе фразы касаниями и при повторном открытии, показ требования к форме на старом активном снимке, сохранение ответа со скобками, вопросы чтения и аудирования, воспроизведение MP3 и обычный вопрос Teens. Опубликованная историческая попытка до и после просмотра совпала целиком.
- Сравнение с базой подтвердило стабильность всех ID, уровней, подуровней и тегов тем. Позиции ключей выбора сохранены. Файлы каталога, карта связей тем и банк Teens совпадают с базой.

## Реестр 148 затронутых идентификаторов

По каждой строке указана основная категория. Итог по категориям — дистракторы 45, контекст и стиль 32, инструкция и форма 31, ключ и альтернативы 27, производный fix 8, соответствие теме 5.

По возможному влиянию на историю — A 33, B 74, C 41.

| ID | Категория | История | Причина | До и после |
|---|---|:---:|---|---|
| `F-G-A1-38` | Дистракторы | B | Any в утвердительном сообщении о наличии здесь не подходит. | условие «Can I have a water, please?» → «I've got any water and a lemon. I can make us a drink.» |
| `F-G-A1-65` | Производный Fix | B | Наследует уточнение формулировки или разбора исходного задания G-A1-65. | условие «I'm really hungry but I didn't have breakfast.» → «I'm really hungry because of I didn't have breakfast.» |
| `F-G-A2-106` | Дистракторы | B | After then может означать «после того момента». After after явно дублирует слово. | условие «Download the form. After then, fill in your name and address.» → «Download the form. After after, fill in your name and address.» |
| `F-G-A2-109` | Ключ и альтернативы | A | That подходит в определительном придаточном о человеке. | ключ «who» → «who / that» |
| `F-G-A2-110` | Ключ и альтернативы | A | That подходит в определительном придаточном о предмете. | ключ «which» → «which / that» |
| `F-G-A2-117` | Дистракторы | B | Are emptying может описывать процесс. Здесь выбирается несогласованная форма empties. | условие «The bins are emptying every Tuesday.» → «The bins are empties every Tuesday.» |
| `F-G-A2-129` | Дистракторы | B | Производное задание переставляет прилагательные местами. | условие «Maya put the spare keys in a smaller than blue box.» → «Maya put the spare keys in a blue small box.»<br>инструкция «общая» → «Use the usual order of size and colour.»<br>ключ «small» → «small blue» |
| `F-G-A2-130` | Дистракторы | B | Производное задание переставляет прилагательные местами. | условие «We saw an older than red bus outside the station.» → «We saw two red old buses outside the station.»<br>инструкция «общая» → «Use the usual order of age and colour.»<br>ключ «old» → «old red» |
| `F-G-A2-18` | Ключ и альтернативы | A | Might, may и could выражают возможность. | ключ «might» → «might / may / could» |
| `F-G-A2-24` | Ключ и альтернативы | A | При переходе через мост over и across подходят. | условие «Walk at the bridge and the restaurant is on your left.» → «Walk at the bridge. The restaurant is on your left on the other side.»<br>ключ «across» → «across / over» |
| `F-G-B1-11` | Ключ и альтернативы | A | That тоже вводит определительное придаточное о человеке. | ключ «who» → «who / that» |
| `F-G-B1-110` | Производный Fix | C | Наследует уточнение формулировки или разбора исходного задания G-B1-110. | условие «I've checked my inbox and spam folder. Perhaps you send the file to the wrong address yesterday.» → «Your card hasn't arrived. Perhaps you send it to my old address yesterday.» |
| `F-G-B1-12` | Ключ и альтернативы | A | Место можно выразить через where, in which или at which. | ключ «where» → «where / in which / at which» |
| `F-G-B1-138` | Инструкция и форма | B | Did not check и didn’t check выражают факт без модального перфекта. | условие «I didn't look at the timetable and missed the last train. I checked it before I left. That was my mistake.» → «I didn't look at the timetable and missed the last train. I should had checked it before I left. That was my mistake.»<br>инструкция «общая» → «Use a modal perfect to express a past mistake or missed opportunity.»<br>ключ «should have checked / ought to have checked / could have checked / didn't check / did not check» → «should have checked / ought to have checked / could have checked» |
| `F-G-B1-139` | Инструкция и форма | B | Went и probably went выражают возможность без модального перфекта. | инструкция «общая» → «Use a modal perfect to express a possibility in the past.»<br>ключ «might have gone / may have gone / could have gone / went / probably went» → «might have gone / may have gone / could have gone» |
| `F-G-B1-142` | Инструкция и форма | B | Are flying и will fly обходят Future Continuous. Допустима вторая позиция still. | инструкция «общая» → «Use the future continuous for the action in progress.»<br>ключ «will be flying / will still be flying / are flying / will fly» → «will be flying / will still be flying / will be still flying» |
| `F-G-B1-143` | Инструкция и форма | B | Am interviewing выражает договорённость без Future Continuous. | инструкция «общая» → «Use the future continuous for the action in progress.»<br>ключ «will be interviewing / will still be interviewing / am interviewing» → «will be interviewing / will still be interviewing / will be still interviewing» |
| `F-G-B1-150` | Инструкция и форма | B | Planning, planned, wanted и meant выражают намерение без требуемой конструкции. | условие «We ate outside, but it started to snow before dinner, so we ate indoors instead.» → «We was going to eat outside, but it started to snow before dinner, so we ate indoors instead.»<br>инструкция «общая» → «Use the past form of be going to for the original plan.»<br>ключ «were going to eat / were planning to eat / had planned to eat / wanted to eat / meant to eat» → «were going to eat» |
| `F-G-B1-151` | Инструкция и форма | B | Planning, planned, wanted и meant являются естественными переформулировками. Требование вынесено в инструкцию. | условие «I cycled to work that morning, but my bike had a flat tyre, so I took the bus instead.» → «I were going to cycle to work that morning, but my bike had a flat tyre, so I took the bus instead.»<br>инструкция «общая» → «Use the past form of be going to for the original plan.»<br>ключ «was going to cycle / was planning to cycle / had planned to cycle / meant to cycle / wanted to cycle» → «was going to cycle» |
| `F-G-B1-45` | Ключ и альтернативы | A | Some salt естественно при просьбе передать соль. | ключ «the» → «the / some» |
| `F-G-B1-62` | Производный Fix | B | Наследует уточнение формулировки или разбора исходного задания G-B1-62. | условие «She mustn't be hungry. She's just eaten a huge pizza.» → «She can't to be hungry. She's just eaten a huge pizza.» |
| `F-G-B1-72` | Ключ и альтернативы | A | Косвенный общий вопрос допускает whether и if. | ключ «if» → «if / whether» |
| `F-G-B1-74` | Ключ и альтернативы | A | Say to someone и tell someone грамматически допустимы. | ключ «told» → «told / said to» |
| `F-G-B2-110` | Ключ и альтернативы | A | Which также возможно в относительной части выделительной конструкции. | ключ «that» → «that / which» |
| `F-G-B2-113` | Ключ и альтернативы | C | Синхронизировали производное задание с бытовым контекстом. | условие «I did sent the invoice. Check the junk folder.» → «I did locked the door. I checked it twice.»<br>ключ «send» → «lock» |
| `F-G-B2-13` | Ключ и альтернативы | A | Notwithstanding тоже вводит уступку с именной группой. | ключ «Despite / In spite of» → «Despite / In spite of / Notwithstanding» |
| `F-G-B2-16` | Ключ и альтернативы | A | Be at home также удовлетворяет конструкции would rather + bare infinitive. | ключ «stay» → «stay / be» |
| `F-G-B2-30` | Инструкция и форма | A | Сильный вывод о прошлом допускает простую или длительную форму модального перфекта. | условие «The ground is wet. It can't have rained last night.» → «The ground is wet. It must had rained last night.»<br>инструкция «общая» → «Use a modal perfect for a strong affirmative deduction.»<br>ключ «must have rained» → «must have rained / must have been raining» |
| `F-G-B2-40` | Дистракторы | B | It’s time we go обычно в американском английском. Going без личного глагола создаёт настоящую ошибку. | условие «It's time we go home. It's getting dark.» → «It's time we going home. It's getting dark.»<br>инструкция «общая» → «Use the past simple after it’s time.» |
| `F-G-B2-52` | Инструкция и форма | B | Срок сам по себе не делает Future Perfect единственной грамматической формой. | инструкция «общая» → «Use the future perfect to describe the length of time up to next June.» |
| `F-G-B2-56` | Производный Fix | B | Наследует уточнение формулировки или разбора исходного задания G-B2-56. | условие «It took me months to be used to the cold winters in Canada.» → «It took me months to getting used to the cold winters in Canada.» |
| `F-G-B2-61` | Производный Fix | B | Наследует уточнение формулировки или разбора исходного задания G-B2-61. | условие «Tom mustn't have been at the party. He was in Paris that weekend.» → «Tom can't has been at the party. He was in Paris that weekend.» |
| `F-G-B2-66` | Ключ и альтернативы | A | Have и get образуют корректный каузатив. | ключ «get» → «get / have» |
| `F-G-B2-72` | Ключ и альтернативы | A | Even so, still и nonetheless выражают тот же переход. | ключ «However / Nevertheless» → «However / Nevertheless / Even so / Still / Nonetheless / That said» |
| `F-G-C1-08` | Ключ и альтернативы | A | Mandative should после essential допустимо в британском английском. | ключ «complete» → «complete / should complete» |
| `F-G-C1-121` | Ключ и альтернативы | A | Несколько формальных уступительных связок сочетаются с существительным. | инструкция «общая» → «Use a formal concessive linker.»<br>ключ «notwithstanding» → «notwithstanding / despite / in spite of» |
| `F-G-C1-125` | Производный Fix | C | Наследует уточнение формулировки или разбора исходного задания G-C1-125. | разбор «For приблизительного числа используется or so после числа. Конструкция it would appear that смягчает вывод.» → «Для приблизительного количества or so ставится после числа: twenty people or so.» |
| `F-G-C1-126` | Производный Fix | C | Наследует уточнение формулировки или разбора исходного задания G-C1-126. | условие «From the audit trail, it would appears that the edit was made after the deadline.» → «From the postmarks, it would appears that the letters were sent on different days.» |
| `F-G-C1-14` | Ключ и альтернативы | A | At which и in which уместны при встрече в кафе. | ключ «in which» → «in which / at which» |
| `F-G-C1-16` | Инструкция и форма | B | Was taking не согласуется с we и не даёт требуемую Past Simple. | условие «It's high time we take a proper holiday. We haven't been away for years.» → «It's high time we have taken a proper holiday. We haven't been away for years.»<br>инструкция «общая» → «Use the past simple after it’s high time.»<br>ключ «took / was taking» → «took» |
| `F-G-C1-23` | Инструкция и форма | A | После 2010 у ’d нет естественного носителя. Возможны развёрнутые варианты будущего в прошлом. | инструкция «общая» → «Report a future event from a point in the past. Write the auxiliary in full.»<br>ключ «would become» → «would become / was to become / was going to become» |
| `F-G-C1-53` | Производный Fix | C | Наследует уточнение формулировки или разбора исходного задания G-C1-53. | условие «She promised she will call me the moment she landed.» → «She promised she will call me the moment she landed. She landed yesterday and called as promised.» |
| `F-G-C1-62` | Инструкция и форма | A | Sure, certain и likely также подходят к to-infinitive в этой фразе. | инструкция «общая» → «Use an adjective of likelihood or certainty.»<br>ключ «bound» → «bound / sure / certain / likely» |
| `F-G-C1-63` | Ключ и альтернативы | A | Was встречается в менее формальном английском после as if. | инструкция «общая» → «Use an unreal past form after as if.»<br>ключ «were» → «were / was» |
| `F-G-C1-64` | Ключ и альтернативы | A | Should get допустимо как британский вариант mandative subjunctive. | ключ «get» → «get / should get» |
| `F-G-C1-69` | Ключ и альтернативы | A | And nor встречается в британском английском как отрицательное согласие. | ключ «neither» → «neither / nor» |
| `F-G-C1-73` | Ключ и альтернативы | A | Speak to и speak with подходят к данному контексту. | ключ «to whom» → «to whom / with whom» |
| `G-A1-15` | Дистракторы | B | Always am возможно в эмфатической речи. | варианты «always am» → «always are» |
| `G-A1-35` | Контекст и стиль | C | Для птиц среди ветвей естественно in that tree. | условие «Can you see ___ birds on that tree over there?» → «Can you see ___ birds in that tree over there?» |
| `G-A1-38` | Дистракторы | B | A water может означать порцию, any water — вопрос о наличии. | условие «Can I have ___ water, please?» → «I've got ___ water and a lemon. I can make us a drink.»<br>варианты «a / many» → «many / few» |
| `G-A1-42` | Инструкция и форма | A | В ключе есть двухсловное отрицание при инструкции «одно слово». | инструкция «общая» → «Write the negative form in the gap. You can use the full form or a contraction.» |
| `G-A1-57` | Дистракторы | B | Артикль the и some возможны при другом известном контексте. | варианты «the / some» → «— / several» |
| `G-A1-60` | Дистракторы | B | I don’t speak French тоже грамматически и прагматически возможно. | варианты «don't» → «doesn't» |
| `G-A1-65` | Дистракторы | B | But допустимо как контраст, поэтому производный Fix получает реальную ошибку. | варианты «but» → «because of» |
| `G-A1-T02` | Контекст и стиль | C | Инфинитив после hate возможен не только в британском английском. | разбор «После hate / like / love — глагол с -ing (в британском варианте возможно и to + глагол).» → «После hate допустимы и waiting, и to wait. Обе формы подходят к этому значению.» |
| `G-A2-123` | Контекст и стиль | C | Still know her неестественно описывает продолжающееся знакомство. | условие «I met Zoe in 2020 and I still know her.» → «Zoe and I met in 2020, and we're still friends.» |
| `G-A2-129` | Соответствие теме | B | Прежние варианты не проверяли порядок двух прилагательных. | условие «Maya put the spare keys in a ___ blue box.» → «Maya put the spare keys in a ___ box.»<br>варианты «smallly / small / smaller than / smallest» → «blue small / small blue / smallest blue / small bluer» |
| `G-A2-130` | Соответствие теме | B | Раньше ошибку можно было найти, не зная порядка возраста и цвета. | условие «We saw an ___ red bus outside the station.» → «We saw two ___ buses outside the station.»<br>варианты «oldest / oldly / old / older than» → «red old / older than red / old red / old reddest» |
| `G-A2-18` | Дистракторы | B | Won’t возможно как прогноз, хотя не объясняет совет взять куртку. | варианты «won't» → «might to» |
| `G-A2-24` | Контекст и стиль | C | Ориентир на другом берегу уточняет переход через мост. | условие «Walk ___ the bridge and the restaurant is on your left.» → «Walk ___ the bridge. The restaurant is on your left on the other side.» |
| `G-A2-29` | Дистракторы | B | While we walked естественно для двух событий в прошлом. | варианты «walked» → «walk» |
| `G-A2-T03` | Инструкция и форма | B | Разные формы подходят для плана, если цель не обозначена. | инструкция «общая» → «Use be going to to complete the sentence about the plan.»<br>ключ «am going to visit / am visiting» → «am going to visit / 'm going to visit» |
| `G-A2-T05` | Инструкция и форма | B | У запланированного перелёта несколько грамматических вариантов. | инструкция «общая» → «Use the present continuous for the future arrangement.»<br>ключ «am flying / am going to fly / will be flying» → «am flying / 'm flying» |
| `G-A2-T12` | Инструкция и форма | A | Should not состоит из двух слов. | инструкция «общая» → «Use the negative form of should. You can write it in full or as a contraction.» |
| `G-B1-110` | Контекст и стиль | C | Почтовый контекст сохраняет предположение и событие вчера. | условие «I've checked my inbox and spam folder. Perhaps you ___ the file to the wrong address yesterday.» → «Your card hasn't arrived. Perhaps you ___ it to my old address yesterday.» |
| `G-B1-116` | Контекст и стиль | C | Бытовая рекомендация вместо резервного копирования. | условие «It's a good idea to back up these files.» → «It's a good idea to keep your receipts until the end of the month.»<br>шаблон «You ___ these files.» → «You ___ your receipts until the end of the month.»<br>ключ «ought to back up» → «ought to keep» |
| `G-B1-138` | Дистракторы | B | Checked был грамматически корректен, но противоречил первой реплике. | варианты «checked» → «should had checked» |
| `G-B1-140` | Инструкция и форма | B | Назван модальный перфект для сожаления. | инструкция «общая» → «Use a modal perfect to express regret about the earlier action.» |
| `G-B1-141` | Инструкция и форма | B | Назван модальный перфект для вероятности и учтены варианты с possibly. | инструкция «общая» → «Use a modal perfect to express a possibility in the past.»<br>ключ «might have left / may have left / could have left / might possibly have left» → «might have left / may have left / could have left / might possibly have left / may possibly have left / could possibly have left» |
| `G-B1-144` | Инструкция и форма | B | Present Continuous описывает будущее, если требование Future Continuous не указано. | инструкция «общая» → «Use the future continuous for the action in progress at noon.»<br>ключ «will still be driving / 'll still be driving / will be still driving / are still driving» → «will still be driving / 'll still be driving / will be still driving / 'll be still driving» |
| `G-B1-145` | Инструкция и форма | B | Названа целевая форма, сохранены две позиции still. | инструкция «общая» → «Use the future continuous for the action in progress at eight.»<br>ключ «will be working / will still be working / 'll be working / 'll still be working / is working / 's working / is still working» → «will be working / will still be working / will be still working / 'll be working / 'll still be working / 'll be still working» |
| `G-B1-150` | Дистракторы | B | Ate выражал совершённое действие и конфликтовал с исходом истории. | варианты «ate» → «was going to eat» |
| `G-B1-151` | Дистракторы | B | Cycled выражал совершённое действие и конфликтовал с поездкой на автобусе. | варианты «cycled» → «were going to cycle» |
| `G-B1-152` | Инструкция и форма | B | Planning, intended и about to могут быть грамматически корректными. | инструкция «общая» → «Use the past form of be going to for the original plan.»<br>ключ «were going to take / were planning to take / had planned to take / meant to take / intended to take / wanted to take / were about to t…» → «were going to take» |
| `G-B1-153` | Инструкция и форма | B | Явно названа требуемая конструкция нереализованного плана. | инструкция «общая» → «Use the past form of be going to for the original plan.»<br>ключ «was going to call / had planned to call / was planning to call / meant to call / intended to call / wanted to call / was about to call» → «was going to call» |
| `G-B1-17` | Дистракторы | B | Could может описывать доступную возможность в прошлом. | варианты «could» → «were able» |
| `G-B1-25` | Ключ и альтернативы | C | Ve без апострофа не нормативная форма. | ключ «have never tried / 've never tried / ve never tried» → «have never tried / 've never tried» |
| `G-B1-32` | Инструкция и форма | B | Will crash тоже допустимый прогноз без требования формы. | инструкция «общая» → «Use be going to for a prediction based on what you can see.» |
| `G-B1-60` | Дистракторы | B | Is opened может описывать расписание в пассиве. | варианты «is opened» → «is opening to» |
| `G-B1-61` | Дистракторы | B | Have to и should могут описывать вывод или ожидание. | варианты «should / have to» → «should to / must to» |
| `G-B1-62` | Дистракторы | B | Mustn’t может выражать отрицательный вывод в американском английском. | варианты «mustn't» → «can't to» |
| `G-B1-73` | Дистракторы | B | This jacket does cost допускается при эмфазе. | варианты «this jacket does cost» → «this jacket is cost» |
| `G-B1-T05` | Соответствие теме | B | Раньше порядок слов уже был дан, а opens и closes были взаимозаменяемы. Теперь ученик строит косвенный вопрос. | условие «Could you tell me what time the museum ___ on Sundays?» → «Could you tell me what time ___ (the museum / close) on Sundays?»<br>ключ «opens / closes» → «the museum closes»<br>тип «gap» → «brackets» |
| `G-B1-T06` | Инструкция и форма | B | Возможность и сильная уверенность грамматически допустимы, если нет требования. | инструкция «общая» → «Use must, might or can’t to express a strong affirmative deduction.» |
| `G-B1-T13` | Инструкция и форма | A | Even though содержит два слова. | инструкция «общая» → «Complete the contrast clause with one or two words.» |
| `G-B1-T14` | Ключ и альтернативы | A | Также подходят nonetheless, still и even so. | инструкция «общая» → «Complete the contrast link with one or two words.»<br>ключ «however / nevertheless» → «however / nevertheless / nonetheless / still / even so» |
| `G-B2-113` | Контекст и стиль | C | Контекст жилого дома сохраняет emphatic do без счёта и почтового фильтра. | условие «I did ___ the invoice. Check the junk folder.» → «I did ___ the door. I checked it twice.»<br>варианты «sent / sending / sends / send» → «locked / locking / locks / lock» |
| `G-B2-129` | Контекст и стиль | C | General English без необходимости представлять рабочее место с двумя мониторами. | условие «I'm getting used to ___ (work) with two monitors.» → «I'm getting used to ___ (work) in a much noisier office.» |
| `G-B2-23` | Инструкция и форма | B | Will finish также возможен для будущего срока. Требуемая форма теперь указана. | инструкция «общая» → «Use the future perfect for an action completed by then.» |
| `G-B2-24` | Дистракторы | B | Always is leaving грамматично при эмфазе. Нейтральный контекст оставляет неоднозначность. | варианты «always is leaving» → «always is leave» |
| `G-B2-26` | Инструкция и форма | B | Без требования формы возможна простая конструкция с will. | инструкция «общая» → «Use the future continuous for the action in progress at that time.» |
| `G-B2-30` | Дистракторы | B | Can’t have rained грамматично, даже если по контексту менее вероятно. В Fix должна быть однозначная ошибка формы. | варианты «can't have rained» → «must had rained» |
| `G-B2-31` | Дистракторы | B | Needn’t have может выражать ненужность позднего отхода ко сну. | варианты «needn't have» → «needn't to have» |
| `G-B2-37` | Дистракторы | B | Apologised about the delay встречается в естественной речи. | варианты «about» → «on» |
| `G-B2-42` | Дистракторы | B | Some hospital грамматически возможно при неизвестной больнице. | варианты «some» → «much» |
| `G-B2-52` | Инструкция и форма | B | Утверждение с will be может описывать тот же юбилей. Назвали Future Perfect. | инструкция «общая» → «Use the future perfect to describe the length of time up to next June.» |
| `G-B2-56` | Дистракторы | B | To be used to описывает достигнутое состояние. Новый дистрактор однозначно неверен. | варианты «be» → «getting» |
| `G-B2-61` | Дистракторы | B | Mustn’t have может выражать отрицательный вывод в американском английском. | варианты «mustn't have» → «can't has» |
| `G-B2-76` | Контекст и стиль | B | Regret to tell может сообщать неприятную новость. Теперь событие явно осталось во вчерашнем дне. | условие «I regret ___ you that. I'm really sorry.» → «I regret ___ you the secret yesterday. I should have kept it to myself.» |
| `G-B2-T05` | Инструкция и форма | A | In spite of содержит три слова при прежней инструкции «одно слово». | инструкция «общая» → «Complete the contrast link. You can use one to three words.» |
| `G-C1-05` | Контекст и стиль | B | Прежний вопрос дословно повторял G-B2-T09. В C1 добавлена связь с завершённым прошлым. | условие «I'd rather you ___ (not / tell) anyone about this yet.» → «I'd rather you ___ (not / mention) the meeting to Dan yesterday. It was supposed to be a surprise.»<br>ключ «didn't tell / did not tell» → «hadn't mentioned / had not mentioned» |
| `G-C1-120` | Контекст и стиль | C | Сложный Past Perfect Passive проверяется на ситуации в театре вместо отказа сервера. | условие «They'd backed up the recordings by the time the server failed.» → «They'd stored the costumes by the time the theatre closed.»<br>шаблон «The recordings ___ by the time the server failed.» → «The costumes ___ by the time the theatre closed.»<br>ключ «had been backed up / 'd been backed up» → «had been stored / 'd been stored» |
| `G-C1-125` | Контекст и стиль | C | Убрали опечатку и посторонний пример. | разбор «For приблизительного числа используется or so после числа. Конструкция it would appear that смягчает вывод.» → «Для приблизительного количества or so ставится после числа: twenty people or so.» |
| `G-C1-126` | Контекст и стиль | C | Вывод по почтовым штемпелям сохраняет модальность и нейтральный C1-контекст. | условие «From the audit trail, it would ___ that the edit was made after the deadline.» → «From the postmarks, it would ___ that the letters were sent on different days.» |
| `G-C1-127` | Контекст и стиль | C | Убрали опечатку и посторонний пример. | разбор «For приблизительного числа используется or so после числа. Конструкция it would appear that смягчает вывод.» → «Ten minutes or so означает «примерно десять минут». Or so стоит после количества.» |
| `G-C1-128` | Контекст и стиль | C | Разбор привязан к проверяемому глаголу seem. | разбор «For приблизительного числа используется or so после числа. Конструкция it would appear that смягчает вывод.» → «It would seem that позволяет сделать осторожный вывод на основе двух счетов.» |
| `G-C1-16` | Инструкция и форма | B | Явно проверяется Past Simple после it’s high time с учётом вариации употребления. | инструкция «общая» → «Choose the past simple after it’s high time.» |
| `G-C1-24` | Инструкция и форма | B | If you require грамматически правильно в том же формальном письме. Целевая инверсия теперь указана. | инструкция «общая» → «Choose the inverted form of the conditional.» |
| `G-C1-50` | Контекст и стиль | B | Will допускается в косвенной речи о событии, которое ещё впереди. Добавили подтверждение, что закон уже вступил в силу. | условие «The minister announced that the new law ___ come into force the following year.» → «The minister announced that the new law ___ come into force the following year. It took effect the following spring.» |
| `G-C1-53` | Контекст и стиль | C | Следующее предложение фиксирует, что приземление и звонок уже произошли. | условие «She promised she ___ call me the moment she landed.» → «She promised she ___ call me the moment she landed. She landed yesterday and called as promised.» |
| `G-C1-54` | Дистракторы | B | Worked возможно при описании завершённого периода. Дистрактор теперь проверяет неправильную форму перфекта. | варианты «worked» → «had working» |
| `G-C1-60` | Контекст и стиль | C | Right now исключает Past Simple в локальном контексте. | условие «You ___ look tired. Why don't you go home early?» → «You ___ look tired right now. Why don't you go home early?» |
| `L-A1-02-q1` | Контекст и стиль | C | Покупательница заказывает и воду, и кофе. Вопрос нацелен на вид кофе. | условие «What does the customer want to drink?» → «What kind of coffee does the customer order?» |
| `L-B1-03-q4` | Контекст и стиль | C | Maybe говорит о намерении, а не о принятом решении. | условие «What does Rachel decide to do?» → «What does Rachel say she might do tomorrow morning?» |
| `L-B1-04-q2` | Дистракторы | C | В записи речь только о поездках на работу. | варианты «He can't imagine driving again» → «He doesn't want to go back to driving to work» |
| `L-C1-03-q5` | Дистракторы | C | Из реплики следует разница в частоте визитов, а не всей помощи матери. | варианты «She feels she does much more for their mother than Sam» → «She feels she makes more effort to visit their mother than Sam does» |
| `L-C1-03-q6` | Дистракторы | C | Мать уже могла принять решение. Договорённость относится к моменту до подписания. | варианты «Visit the place with their mother before she decides» → «Visit the place with their mother before she signs anything» |
| `L-C1-04-q3` | Дистракторы | C | Реставрация скрыла исходный смысл, который обнаружился на рентгене. | варианты «Confident restorers can destroy a work's meaning» → «Confident restorers can obscure what the artist intended» |
| `R-A1-01-q1` | Контекст и стиль | C | Вопрос теперь о стандартном графике, поскольку 1 января бассейн закрыт. | условие «When is the pool open?» → «How often is the pool normally open?» |
| `R-A1-04-q1` | Контекст и стиль | B | Без указания дня и завтрак, и утренняя работа упоминаются в тексте. | условие «What does the writer do in the morning?» → «What does the writer do on Sunday morning?» |
| `R-A2-01-q1` | Контекст и стиль | C | Сухой торт не означает, что он совсем не понравился. | условие «What didn't the writer like?» → «Which part of the meal did the writer find a bit dry?» |
| `R-B1-01-q3` | Дистракторы | C | Софа показывает отсутствие гостевой кровати, но не отсутствие отдельной комнаты. | варианты «It doesn't have a spare bedroom» → «There probably isn’t a guest bed for Jess» |
| `R-B1-04-q4` | Дистракторы | B | Участники могут забрать свою чашу позже, поэтому bowl to take home допускало прочтение через материалы. | варианты «A bowl to take home» → «A ready-made bowl to take home that day» |
| `R-B2-01-q1` | Контекст и стиль | C | В тексте большинство работников и многие компании, а не большинство испытаний. | условие «What did most of the trials show?» → «What did employees and companies report in the trials?»<br>варианты «Employees were less stressed and productivity didn't fall» → «Less stress, and stable or higher productivity» |
| `R-B2-01-q4` | Дистракторы | C | Works best when не означает only if. | варианты «It's a good idea, but only if work is organised differently» → «It's worth trying alongside changes to how work is organised» |
| `R-B2-01-q5` | Дистракторы | C | Сокращаем ключ без изменения смысла. | варианты «It helps them attract talented staff» → «It attracts talented staff» |
| `R-C1-03-q5` | Дистракторы | C | Принадлежность содержимого коробки матери не указана. | варианты «In a box of the mother's things» → «In a box the narrator's mother had meant to sort through» |
| `V-A1-22` | Контекст и стиль | A | Complete homework соответствует коллокации. Уточнили, что речь о выполненной работе. | условие «I always ___ my homework after dinner.» → «I always ___ all my homework after dinner. By eight it's ready.»<br>ключ «do / finish» → «do / finish / complete» |
| `V-A1-30` | Соответствие теме | B | В теме Basic adjectives проверялся глагол see. | условие «Can you ___ the bus? It's coming now.» → «That bus is really ___. I can walk faster than that.»<br>варианты «watch / look / see / listen» → «short / early / slow / quiet» |
| `V-A2-21` | Соответствие теме | B | В Feelings and personality проверялось tell the time. | условие «Can you ___ me the time, please?» → «Ella looks happy even on difficult days. She's a very ___ person.»<br>варианты «say / speak / talk / tell» → «careless / nervous / gloomy / cheerful» |
| `V-A2-22` | Ключ и альтернативы | A | Stingy и ungenerous подходят для человека, который неохотно делится. | ключ «selfish / mean» → «selfish / mean / stingy / ungenerous» |
| `V-A2-23` | Ключ и альтернативы | A | Proud, thrilled и relieved естественны после хорошей оценки. | ключ «happy / pleased / glad / excited / delighted» → «happy / pleased / glad / excited / delighted / proud / thrilled / relieved» |
| `V-A2-26` | Дистракторы | B | Voyage может подходить для поездки по воде. Поездка на автобусе снимает эту трактовку. | условие «How was your ___ to Paris?» → «How was your weekend ___ to Paris by coach?» |
| `V-A2-34` | Дистракторы | B | Rented допустимо при платной аренде. Уточнили, что платы не было. | условие «My brother ___ me his car for the weekend, so we drove to the lake.» → «My brother ___ me his car for the weekend. He didn't charge us, and we gave it back on Monday.» |
| `V-B1-22` | Дистракторы | B | Forgot my phone at home встречается в американском английском. | варианты «forgot» → «forgotten» |
| `V-B1-31` | Дистракторы | B | Write out a form может означать выписать бланк. | варианты «write» → «carry» |
| `V-C1-21` | Дистракторы | B | Hard evidence является нормативной коллокацией. | варианты «hard» → «tough» |
| `V-C1-24` | Дистракторы | B | Growing accord допускает ту же трактовку, что consensus. | варианты «opinion / accord» → «inference / accordance» |
| `V-C1-25` | Инструкция и форма | B | Tell грамматически возможно. Критерий выбора — самый формальный уместный вариант. | инструкция «общая» → «Choose the most formal wording for this email.» |
| `V-C1-30` | Ключ и альтернативы | A | Hard affected не нормативная коллокация. Substantially, markedly и materially подходят по смыслу. | ключ «severely / seriously / badly / heavily / significantly / greatly / hard» → «severely / seriously / badly / heavily / significantly / greatly / substantially / markedly / materially / drastically» |
| `V-C1-39` | Дистракторы | B | Happily surprised встречается в естественном английском. | варианты «nicely / happily» → «fondly / cheerfully» |
| `W-A2-03` | Контекст и стиль | C | Совет другу не требует Past Simple или будущего времени. | памятка «Past Simple и способы говорить о будущем (going to, will) в основном верны» → «Настоящее время подходит для привычек. Простые конструкции с can и could подходят для советов.» |
| `W-A2-05` | Контекст и стиль | C | Для проверки сообщения достаточно вымышленных контактов. | пункты «give your contact details» → «include fictional contact details» |
| `W-B1-05` | Контекст и стиль | C | Жалобу отправляют продавцу, поэтому дружеский тон не является целевым. | памятка «Стиль подходит адресату (дружеский или нейтральный)» → «Вежливый нейтральный стиль обращения в магазин.» |
| `W-B2-04` | Контекст и стиль | C | Требуемый жанр — официальное письмо, а не эссе или отзыв. | памятка «Стиль соответствует жанру (эссе или отзыв)» → «Официальный регистр письма транспортной компании.» |
| `W-B2-05` | Контекст и стиль | C | В рубрике указан жанр статьи. | памятка «Стиль соответствует жанру (эссе или отзыв)» → «Стиль статьи подходит читателям онлайн-журнала.» |
| `W-C1-04` | Контекст и стиль | C | В памятке отсутствовал жанр рецензии. | памятка «Задача выполнена полностью, жанр выдержан (эссе, отчёт или предложение)» → «Текст выполняет задачу рецензии на книгу или фильм.» |
| `W-C1-05` | Контекст и стиль | C | В памятке отсутствовал жанр письма-рекомендации. | памятка «Задача выполнена полностью, жанр выдержан (эссе, отчёт или предложение)» → «Официальное письмо содержит рекомендацию и отвечает на все пункты задания.» |
