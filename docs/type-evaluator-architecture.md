# Type evaluator architecture

The evaluator refactor is based on upstream
`b57fefae2650597bd1a0f7fb3ce821015c25d317`, not on the older evaluator implementation.
Current upstream typing behavior, diagnostics and feature support supersede the
algorithms on `bschnurr/pyright`'s `typeEval-explained` branch.

## Ownership and dependency direction

`analyzer/typeEvaluator.ts` remains the entry point. `createTypeEvaluator` owns
the evaluator interface, caches, speculative state, cancellation state and code
flow engine. `typeEvaluatorTypes.ts` retains its upstream public API.

Topic factories in `analyzer/typeEvaluator/` receive private, typed dependency
contexts once per evaluator. Immutable dependencies are captured once. Mutable
bindings such as prefetched builtins and contextual-return inference caches use
live getters and, where necessary, setters into the original evaluator closure.
Collections that are mutated in place retain their original identity.

Functions within one topic call each other directly. Cross-topic calls use
evaluator-owned callbacks. Extracted modules must not import `typeEvaluator.ts`;
the code flow engine must not acquire an evaluator implementation dependency.
Private shared contracts live in `internals.ts`. The existing `EvaluatorOptions`
and `MemberAccessTypeResult` exports remain available from `typeEvaluator.ts`.
Stateless literal and unpacking helpers use ordinary module exports.

## Topic boundaries

| Module | Responsibility |
| --- | --- |
| `literalTypes.ts` | Literal, TypeGuard and TypeIs normalization |
| `pureHelpers.ts` | Stateless tuple-like unpacking |
| `diagnostics.ts` | Evaluator diagnostics and diagnostic context |
| `flowAnalysis.ts` | Reachability and code flow adapters |
| `evaluatorNarrowing.ts` | Evaluator truthiness and assignment narrowing |
| `typeGuardNarrowing.ts` | Conditional and type guard narrowing helpers |
| `collectionInference.ts` | Lists, sets, dictionaries and comprehensions |
| `specialFormCreation.ts` | Current special typing forms and synthesized types |
| `typeVarHandling.ts` | Type variables, variance and specialization |
| `overrideValidation.ts` | Method and attribute override compatibility |
| `memberResolution.ts` | Member access, declarations and symbol resolution |
| `boundMethodSpecialization.ts` | Current bound receiver and method specialization |
| `classConstruction.ts` | Class synthesis and effective metaclass selection |
| `returnTypeInference.ts` | Contextual return inference and inference-frame queries |
| `expressionEvaluation.ts` | Expression evaluation and argument handling |
| `assignFunctions.ts` | Type assignment and compatibility |
| `evaluatorCore.ts` | Remaining evaluator lookup, validation and specialization helpers |
| `internals.ts` | Private contracts shared by implementation modules |

The two narrowing modules are separate layers: `evaluatorNarrowing.ts` provides
truthiness and assignment primitives; `typeGuardNarrowing.ts` applies conditional
and type guard tests using those primitives. Scalar string evaluation and
forward-annotation parsing belong to `expressionEvaluation.ts`, while callable
parameter packing is private to `assignFunctions.ts`.

`returnTypeInference.ts` uses the original evaluator-owned inference stack and
live cache getters/setters. It does not own replacement evaluator state.
`evaluatorCore.ts` is a remaining-helper group, not a cohesive architectural
layer or a destination for new unrelated helpers. Callback dependencies may
still form cycles; these topic boundaries do not imply an acyclic call graph.

The remaining closure-local functions are intentional. This migration reproduces
the old branch's completed boundaries using current code; it does not redesign
the remaining evaluator state or attempt to move every upstream function.

## Historical migration

The migration covers the final architectural outcomes of all 135 source commits
and all 206 old evaluator delegators. There are 205 surviving current-code
equivalents. Bound-method specialization is also extracted, inference frame push
and pop operations retain their current inline implementation, and obsolete
message-formatting scaffolding is not restored. The old `isTypeFormSupported`
helper is absent from current upstream and is not resurrected.

Intermediate moves, corrections, redundant wrappers and public-interface
scaffolding are represented by their final architectural outcome, not replayed
as historical patches, not one-for-one cherry-picks.

## Validation

Use the current pnpm workspace commands:

```powershell
pnpm run typecheck
pnpm run check
pnpm --dir packages\pyright-internal test --maxWorkers=2
pnpm run build:cli:dev
```

Check moved bodies against the chosen upstream revision after normalizing only
explicit dependency plumbing. Preserve existing test expectations and inferred
type precision. Run relevant tests and lint before each refactor commit, and the
full suite after integration. Clean benchmarks are separate evidence: passing
tests and equivalent source bodies do not establish performance equivalence.
