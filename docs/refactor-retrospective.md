# Current evaluator migration retrospective

The 135 commits on `bschnurr/pyright`'s `typeEval-explained` branch were migrated
as validated architectural batches onto upstream
`b57fefae2650597bd1a0f7fb3ce821015c25d317`. They were not cherry-picked onto the
new evaluator, and outdated implementations were not restored.

The [architecture guide](type-evaluator-architecture.md) describes the current
module boundaries and ownership rules.

## Deliberate differences from the old refactor

- Current implementations take precedence over historical simplifications,
  diagnostics and feature checks.
- Topic factories use narrow private contexts, not an expanded public
  `TypeEvaluator` interface.
- Mutable evaluator bindings stay in the original closure and are accessed
  through live properties. They are not snapshotted when a factory is created.
- Literal normalization and evaluator truthiness have distinct modules from
  type guard narrowing.
- Intermediate moves, restorations, empty scaffolding and duplicated adapters
  are consolidated rather than reproduced.
- Current pnpm build and test commands replace historical npm instructions.

## Verification and limits

The migration uses TypeScript symbol analysis for dependency extraction and
mechanical comparisons against current upstream bodies. Core and workspace
typechecks, formatting, lint and relevant existing tests gate implementation
commits. The integrated tree must pass the full test suite without weakened
expectations.

Historical line counts, test counts and performance claims are not applicable
to the modern tree. Factory allocation and cross-topic callback dispatch may
affect runtime cost even with equivalent function bodies. A bounded clean CLI
comparison can detect large changes, but does not prove production performance,
memory usage or warm editor responsiveness.
