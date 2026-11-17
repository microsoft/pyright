# Choosing adversarial probes

Use the probe menu after tracing the diff, not as a mandatory list of language features. The
[repair-completion checkpoint](#repair-completion-checkpoint) applies when repairing shared inference or narrowing logic.

Select dimensions for each concrete hypothesis using [discovery-coverage.md](discovery-coverage.md). A feature appearing in one probe does not establish coverage of its interactions with another failure condition. Preserve the same intended-safe or intended-unsafe relation when testing a new representation.

| Changed area | Useful probes | Failure to look for |
|---|---|---|
| TypeVar inference/constraints | Explicit versus synthesized constraints; bound/unbound controls; `Never`/`NoReturn`, `Any`/`Unknown`; reordered constraints; repeated and reordered arguments; expected return context | No-match sentinel becomes a real match, a real solution is discarded, or later inference widens an invariant argument |
| Generic containers | Fresh literal versus pre-typed alias; mutable list/dict/custom box; read-only Sequence; nested containers; covariance and contravariance | Acceptance succeeds for an empty example but permits incompatible writes through a live alias |
| `Self` and member assignment | Class versus instance receiver; base/child/grandchild; `T` and `type[T]`; concrete/union receivers; properties, descriptors, methods; tuple/chained targets | Wrong receiver substitution, leakage between union branches, setter context or method binding |
| Union helpers and short-circuiting | Every caller; singleton/nonempty union; failing member first/middle/last; `Any`, `Unknown`, `Never`; conditional members | Predicate return value changes, skipped side effects, order dependence or changed reachability |
| Narrowing and match cases | Positive/negative branches; union alternatives; aliases and intervening mutation; unknown/custom equality; class versus instance values | Reachable values eliminated, stale narrowing retained, or branch inferred as unreachable |
| Unreachable local bindings | Assignment and declaration forms; capture patterns including mapping rest `case {**x}`; nested-scope boundaries; reachable reads before unreachable bindings | A missed binding makes a reachable read incorrectly resolve to an outer variable; distinguish incomplete fixes from introduced regressions |
| Callables and overloads | Positional/keyword forms; `*args`/`**kwargs`; overload order; Any arguments; callback parameter/return variance; ParamSpec controls | Successful inference masks an incompatible call shape or selects an unjustified overload |
| Call-domain and binding changes | Cross the relevant receiver bindings with the same overlapping or disjoint call shapes; consider naming, defaults, argument channels, and ordering together | A change in binding or spelling hides a shared call, or an unrelated safe control is mistaken for coverage of the unsafe pattern |
| Variadic arity and specialization | Boundary pack lengths; fixed and variable regions; inferred and explicit gradual types; concrete and generic representations; distinct element types where alignment matters | A minimum-arity proof fails at an empty instantiation, positional alignment changes, or an erased distinction hides an incompatible argument |
| Type precision and summaries | Shape, element position/type, optionality and correlations; constrained consumers and element operations; fresh, aliased, annotated and inferred inputs | The motivating operation improves while another consumer loses necessary information or accepts an invalid use |
| Operator and fallback dispatch | Actual method-result contract; direct/reflected alternatives; scalar and nested operands; deciding and non-deciding prefixes when short-circuiting applies | A callable method is mistaken for a completed operation, the result type is discarded, or later checks contradict the information established by an earlier check |
| Parser/diagnostic changes | Adjacent syntax forms; implicit versus explicit operations; supported language versions; valid neighboring constructs | Wrong diagnostic category/range, duplicate errors, accepting syntax CPython rejects |
| Metadata flags | Construction by each syntax; clone/specialization paths; reset/replacement of underlying data; recursion | Stale or absent flag changes behavior far from the declaration |

## Repair completion checkpoint

Apply this bounded check as part of the existing repair self-review, not as a second review workflow. It does not require
another agent, a new reviewer panel, an exhaustive matrix, or repeating compatible completed checks.

1. Revisit the original behavior change and the repair, not only the reported reproductions. Identify changed decisions,
   newly admitted or skipped inputs, and type information added, removed, or no longer correlated. Check what each
   predicate actually establishes against what its callers conclude.
2. Select a small set of discriminating combinations for uncovered decisions and consumers using the menu above and,
   where applicable, the narrowing recipe below. Testing relevant dimensions separately does not cover their interaction.
   Include a valid consumer, a nearby invalid consumer that must retain its diagnostic, and an unaffected control.
3. Derive expectations independently of the repaired output. Compare exact revealed types and diagnostic identities on
   the pre-repair and repaired snapshots; also use the pre-PR baseline when needed to attribute a change to the PR.
   Reuse existing comparisons when revisions, configuration, and affected paths remain compatible. State missing evidence.
4. Reuse or maintain the compact [coverage record](discovery-coverage.md#coverage-belongs-to-a-hypothesis-and-a-combination).
   Link each selected decision/combination to its expected consumer behavior and actual execution evidence. Mark it
   executed, excluded with a code-based reason, or untested; a case count or passing suite is not evidence for a missing
   combination.
5. Before reporting completion, reconcile that record against the original change and repair. Report remaining failures,
   material coverage gaps, and precision or policy tradeoffs rather than treating them as passing. New findings do not
   authorize expanding the repair scope or weakening existing expectations.

## Narrowing and union interactions

For changes to narrowing, containment, or equality, select relevant combinations from the touched branches. These are
probes for particular hypotheses, not a universal narrowing policy or a requirement to fix unrelated baseline behavior.

- Distinguish an `Any`/`Unknown` guarded value from an `Any`/`Unknown` element or key in one container alternative. When
  optionality is affected, combine those inputs with a known `None` alternative. Obtain `Unknown` through real inference
  and inspect the resolved input types; a test's annotations or similar syntax do not prove it exercised that path.
- Check explicitly optional inputs separately from optionality newly introduced by the guard. Do not assume a `None`
  alternative is redundant merely because `Any` or `Unknown` also survives. Retain material losses of partial information
  as policy tradeoffs even when the remaining gradual type permits the runtime operation.
- Separate equality from runtime type identity. When relevant, use equal values from different built-in classes, such as
  `float`/`int` or `set`/`frozenset`, and compare literal with nonliteral cases. Matching a value by equality does not by
  itself establish the matching element's runtime class.
- Exercise positive and negative guard outcomes, relevant compound-condition merges, and alternative order when different
  paths or early exits can change the result. Pair fully known inputs with the corresponding gradual or mixed union.
- Use ordinary consumers as well as revealed types. For a float equal to an integer literal, `value.hex()` distinguishes
  preserving the float from replacing it with an integer literal; `value.bit_length()` tests the opposite error. For
  optionality, pair the valid member access being repaired with a case whose reachable `None` access must still warn.
  Justify static expectations separately from runtime witnesses; failure through an explicitly gradual type alone does
  not establish a typing violation.

## Example of a useful mutation test

For a change involving constrained TypeVars and a bottom type, testing only `extract(Box[Never]())` checks the intended inference. Also test whether combining arguments can invalidate a pre-existing object's element type:

```python
from typing import Never, TypeVar, assert_never

T = TypeVar("T", int, Never)

def append_one(items: list[T], value: T) -> None:
    items.append(value)

items: list[Never] = []
append_one(items, 1)  # Must not be accepted by widening the list's type.
assert_never(items[0])
```

Run a related control without the changed feature and test read-only covariance separately. If a baseline already has a similar hole in another configuration, describe it without erasing the newly changed behavior in the reproduction. Do not infer that every use of Never, generic inference or mutation is broken.

## Avoid weak success criteria

- “The file has an error” is insufficient if the intended bad call is silently accepted and a separate declaration fails.
- “All assert_type calls passed” is insufficient if earlier Never inference made them unreachable.
- “Fewer diagnostics” is insufficient if invalid programs are newly accepted.
- “Python ran it” is insufficient for annotations: inspect the operational consequence, and use typing semantics for static compatibility.
- “The full suite passed” does not replace a test for a new interaction absent from that suite.
- A large matrix of repeated shapes is not exhaustive coverage. Explain which semantic branches it exercises.
- Testing dimensions separately is not coverage of their relevant combinations under the same hypothesis. Preserve links from each coverage claim to the cases that actually establish it.
