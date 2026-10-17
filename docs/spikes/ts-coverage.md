# TypeScript coverage spike

The task asks for five TypeScript repositories from the corpus, using jest and vitest, before a decision between line coverage and the import fallback.

tools/corpus is still planned on this branch. No sample has been drawn. The sampler that draws one needs another lane's token, and this note does not use that token. It does not name repositories that are not in that sample, and it does not record a decision.

A local check of NODE_V8_COVERAGE through a hand-written source map, on one synthetic module, can run without that sample. It is not the corpus spike.
