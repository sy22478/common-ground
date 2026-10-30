# Sentences for a native reader

The questions on the page are written by a model (NVIDIA Nemotron 3 Ultra) in English and then put into the
grandparent's language by the same model. Nobody who speaks Spanish or Hindi natively has read them yet. This file
keeps the sentences a native reader should look at: the ones I doubt, and a sample of the ones I could not fault.

How to use it: read each sentence as a grandchild speaking to a grandparent. In the last column write "fine", or the
sentence as you would say it. One line on why helps: each correction that has a fixed shape becomes a rule in
`lib/wording.ts`, with a test.

Where a sentence named a film or an artist that Qloo returned, the name is replaced by [title] or [artist]: Qloo's
data stays out of this repository. A favorite that we typed ourselves (the sample family's, or an invented family's)
is left as it is.

## Spanish, spoken to a grandmother by her grandson

Sentences I doubt. Each of 1, 3 and 4 is now refused by a rule; 2 is not, because I am not sure it is wrong.

| # | Spanish, as the model wrote it | The English it came from | My doubt | Reader |
|---|---|---|---|---|
| 1 | ¿Cuál fue una película que sintió como si hubiera sido hecha solo para ti? | What was a movie that felt like it was made just for you? | "que sintió como si" is English "felt like" word for word: the film is made the one that feels. I would expect "que sentiste que estaba hecha solo para ti". Seen on 2026-10-11 in one of six recorded plans | |
| 2 | ¿Hay alguna canción que siempre te trae un recuerdo específico a la mente? | Is there a song that always brings a specific memory to mind? | After "¿Hay alguna ... que" I would expect the subjunctive, "te traiga". Is the indicative wrong here, or only less careful? | |
| 3 | ¿Qué canción te gustaría que estuviera sonando la primera vez que te sostuviera? | What song would you want playing the first time you held me? | The roles are turned round: the Spanish says "the first time I held you". The English question is now refused too: it assumes something about their past | |
| 4 | ¿Cuál es tu cosa favorita para hornear juntas? | What is your favorite thing to bake together? | "juntas" for a grandmother and a grandson. The app is never told whether the visitor is a man or a woman, so the rule now refuses "juntas", "nosotras", "las dos", "ambas" and "solas". Is "juntos" acceptable when both are women, or should the sentence avoid the word? And is "tu cosa favorita para hornear" natural? | |

Sentences I could not fault. 8 (without "abuela"), 9 and 10 are on the public page now. 8, 9 and 14 are in the
recording that waits for the next deploy. 5 to 7 were on the page until 2026-10-11.

| # | Spanish, as the model wrote it | The English it came from | Reader |
|---|---|---|---|
| 5 | ¿Qué canción me pondrías si pudiéramos escuchar cualquier orquesta ahora mismo? | What song would you play for me if we could hear any orchestra right now? | |
| 6 | ¿Qué olor de cocina en las fiestas te lleva directo a la niñez? | Which holiday kitchen smell takes you straight back to childhood? | |
| 7 | Si pudieras entrar en cualquier mundo animado por un día, ¿cuál elegirías? | If you could step into any animated world for a day, which one would you choose? | |
| 8 | ¿Qué escena de [title] se te quedó grabada, abuela? | What scene in [title] stayed with you the most? | |
| 9 | ¿Qué canción de [artist] pondrías primero? | Which song by [artist] would you play first? | |
| 10 | ¿Qué recuerdo te viene cuando haces tamales? | What memory comes up when you make tamales? | |
| 11 | ¿Cuál es el secreto de tus tamales? | What is the one secret to your tamales? | |
| 12 | ¿Qué te gusta hornear cuando refresca? | What do you like to bake when the weather turns cool? | |
| 13 | Si pudieras escribir una canción sobre nuestra familia, ¿qué diría el coro? | If you could write a song about our family, what would the chorus say? | |
| 14 | ¿Qué relleno hace que el tamal sea tuyo? | What filling makes a tamal yours? | |
| 15 | ¿Qué recuerdo te viene al oler tamales recién hechos? | What memory comes up when you smell fresh tamales? | |

Two things to tell us beyond the sentences:

- In 8 the model added "abuela", which the English does not have. Is that welcome, or should the page leave the form
  of address to the family?
- The page keeps a film's title as Qloo gives it, in English, inside a Spanish question. Would you rather hear the
  title the film had in Spanish-speaking countries?

## Hindi, spoken to a grandfather

From one plan made on 2026-10-11 for an invented family. The rules check two things only: that the sentence is in
Devanagari, and that it does not use तुम or तू for an elder.

| # | Hindi, as the model wrote it | The English it came from | My doubt | Reader |
|---|---|---|---|---|
| 1 | (not kept here: it holds a title Qloo returned) | What scene in [title] felt closest to your heart? | The model translated the film's English title into Hindi words, as if it were a phrase. The translator is now told never to translate a title, only to write its sound. No rule can check that in another script | |
| 2 | आप सबसे पहले मोहम्मद रफ़ी का कौन सा गाना बजाएंगे? | Which Mohammed Rafi song would you play first? | None that I can see | |
| 3 | मसाला चाय की खुशबू के साथ कौन सी याद आती है? | What memory comes with the smell of masala chai? | None that I can see | |
| 4 | जब दोपहर शांत होती है तो आप क्या बनाना पसंद करते हैं? | What do you like to bake when the afternoon is quiet? | "बनाना" is "to make", not "to bake". Is there a natural word for baking here? | |
| 5 | अगर हम साथ में किसी फिल्म की दुनिया में कदम रख सकें, तो हम कहाँ जाएंगे? | If we could step into any film world together, where would we go? | None that I can see | |

## What the rules do, so the reader knows what is already caught

`lib/wording.ts`, function `translationProblem`. A sentence that trips one of these is not shown: the second model
is asked, and if its version trips too, a spare question takes its place.

- Any language: the sentence is empty, is still the English, or changes who is named.
- A language in Latin letters: a card's title was changed.
- Spanish: an opening or closing question mark is missing; "sintió como si" and "hacer sentido" (English put word
  for word); a masculine word for a grandmother or a feminine one for a grandfather ("de niño", "de pequeña"); a
  word that makes the two of them women.
- Hindi: not in Devanagari; तुम or तू for an elder.

A rule sees a shape, not a meaning. Sentence 2 above shows the limit: only a reader can settle it.
