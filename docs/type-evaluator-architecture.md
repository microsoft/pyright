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
| `tupleUnpacking.ts` | Stateless tuple-like unpacking |
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
| `returnTypeInference.ts` | Contextual call-site return inference and inference-frame queries |
| `expressionEvaluation.ts` | Expression evaluation and argument handling |
| `typeCompatibility.ts` | Class, union, parameter and callable type compatibility |
| `evaluatorCore.ts` | Remaining evaluator lookup, validation and specialization helpers |
| `internals.ts` | Private contracts shared by implementation modules |

The two narrowing modules are separate layers: `evaluatorNarrowing.ts` provides
truthiness and assignment primitives; `typeGuardNarrowing.ts` applies conditional
and type guard tests using those primitives. Scalar string evaluation and
forward-annotation parsing belong to `expressionEvaluation.ts`, while callable
parameter packing is private to `typeCompatibility.ts`.

## Where to start

This is a navigation map, not an acyclic dependency graph. Start in
`typeEvaluator.ts` for dispatch, orchestration and evaluator state, then follow
the operation to its topic:

| Operation | Implementation path |
| --- | --- |
| Expression or call argument | Expression dispatch -> `expressionEvaluation.ts` |
| List, set, dictionary or comprehension | `collectionInference.ts`, including entry inference and clause evaluation |
| Dictionary entry inference | Expected-type or unconstrained inference -> `inferDictionaryEntries` -> key/value entries, mapping expansion or comprehension |
| Member access or declaration lookup | `memberResolution.ts` -> receiver binding in `boundMethodSpecialization.ts` |
| Call matching and overload selection | Main evaluator -> argument expansion in `expressionEvaluation.ts` -> `typeCompatibility.ts` |
| Conditional or type guard test | `typeGuards.ts` -> `typeGuardNarrowing.ts` -> evaluator narrowing primitives |
| Contextual return type at a call site | `returnTypeInference.ts`; ordinary function return inference remains in the main evaluator |

Each factory's returned functions are private implementation entry points.
Some back public evaluator methods through the facade, but those methods are
defined by `TypeEvaluator` in `typeEvaluatorTypes.ts`. A topic export does not
itself extend that interface.

Dictionary entry inference owns its key/value result arrays and reports
incompleteness and type errors separately from the final dictionary type.
`inferDictionaryKeyEntry` handles expected value types and literal-key replacement;
`tryInferDictionaryExpansion` handles mapping and TypedDict unpacking. The entry
sampling limit restricts retained types, not evaluation or diagnostics.

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
