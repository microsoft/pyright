# From changed semantics to executed coverage

Use this during discovery and when deciding whether a review is complete. The purpose is to expose consequential missing cases, not to produce a large checklist. Keep the coverage record with the review evidence, outside the skill and source checkout. Markdown or JSON is sufficient; no particular harness is required.

## Build the hypothesis inventory from the change

Do this before starting from familiar examples. For each semantic change, identify the affected decision or information, its contract, and where it is used. Share entries when several lines implement the same decision; ignore edits with no semantic consequence.

| Change | Questions that generate hypotheses | Witness to construct |
|---|---|---|
| Acceptance predicate, fallback, or early exit | What input domain is newly admitted or skipped? What must remain rejected? What alternatives stop being examined? | A concrete input in the changed region, then a nearby input for which the required conclusion is false |
| Type construction, narrowing, or widening | Which properties disappear, appear, or stop being correlated? Which consumers depend on each? | Both a type observation and an ordinary consumer whose legality depends on the affected property |
| Binding, specialization, or representation | Do equivalent inputs take different paths? Does a summary describe all instantiations or just the example? | Equivalent forms, boundary instantiations, and a form that deliberately changes the contract |

The PR's motivating example is one entry, not the entire inventory. Trace callers and consumers far enough to locate a meaningful operation. If an output type changes but the plan contains no consumer of the changed information, resolve that omission or state why no such consumer is affected. Before finishing, revisit the inventory against the diff without using the existing probe list as the sole checklist.

## Construct witnesses rather than naming features

For call-domain changes, reason about concrete calls accepted by each signature. Derive candidate calls from required and optional arguments, argument channels, parameter types, and boundary arities. In particular, omitting an optional component can reveal a shared call that examples supplying every argument miss. Verify that the witness still belongs to the intended domains after binding or specialization; signature resemblance is not an oracle.

For variadic or generic changes, derive minimum and permitted arities after specialization, including empty/singleton instantiations and the boundaries imposed by fixed regions. Use distinct types when homogeneous values would conceal alignment or correlation errors. Treat gradual callable forms according to the typing rules rather than assuming they behave like concrete zero-or-more arguments.

For expression or alias changes, vary how the same relevant value is produced when the code paths differ, not just how it is consumed. For example, a control-flow merge and a direct alias can preserve different metadata. These are selected dimensions for a concrete changed contract, not mandatory families for unrelated PRs.

## Challenge the claimed implication

For a consequential changed branch, write down:

- The predicate or helper result the implementation observes.
- What that observation actually guarantees, including flags, exceptional results, and information discarded by the caller.
- The stronger conclusion used to accept, reject, transform, or skip something.
- A concrete witness that could separate those two claims, and a control where the implication is valid.

For example, failure of containment in both directions does not prove that two sets are disjoint. Construct a shared member instead of treating failed containment checks as an overlap oracle. Similarly, finding an applicable operation does not by itself establish its result type, runtime completion, or permission to discard later alternatives. Read and exercise the actual contracts; these are reasoning prompts, not presumed bugs in every use of such helpers.

Trace where the new result goes next. A positional check followed by an aggregate check, or a precise result reduced to a boolean and then recomputed, can lose the fact that justified the earlier decision. Probe the boundary between those stages as well as the stages separately. Reuse of an existing helper is not sufficient evidence that it establishes the new caller's required property.

## Coverage belongs to a hypothesis and a combination

Derive dimensions from changed branches, callers, representations, and consumers. For each hypothesis, select the combinations that can exercise different semantics. Small relevant products can be generated; larger spaces need justified representatives and targeted interactions. Do not require an exhaustive product of unrelated language features.

A useful record has these fields:

| Changed decision/property and hypothesis | Relevant combination | Independent oracle | Source and observed evidence | Status / classification |
|---|---|---|---|---|
| A shared call must preserve its promised output | Binding form A with call shape X | A concrete call accepted by the public contract; compatible return required | Case path; baseline/head diagnostic or type assertions; runtime consequence if relevant | Executed; regression, intended change, existing issue, incomplete fix, or unresolved |
| The same property | Binding form B with the same call shape X | Re-establish the same call after binding | No execution yet | Untested; do not infer coverage from another case using form B |

The record can be much smaller than the test set: group equivalent cases when the entry links the executed variants. It must still distinguish hypothesis A with form X from hypothesis B with form X.

After a failure, retain its triggering relation while varying relevant surroundings. Renaming identifiers, rebinding a receiver, nesting a value, or changing an equivalent spelling can be useful transformations when the affected paths justify them. Check that each transformation still satisfies the original oracle; syntax changes are not automatically semantics-preserving. Include nearby controls that remove the triggering relation while keeping the surroundings similar.

One discovered defect can have several meaningful variants. Record their coverage without counting every variant as an independent root cause. Do not substitute a safe variant for an unsafe one, a concrete case for a generic case, or checking a value's container for checking its elements.

## Follow information into its consumers

When a change alters a type or a summary of it, identify which properties it preserves and loses. Relevant properties may include shape, position, element type, literal identity, optionality, generic correlation, mutability, or operation result type.

Choose consumers that depend on those properties. Examples include passing a value to a constrained parameter, performing an element operation, reading and writing through an alias, or reaching a branch whose validity depends on narrowing. Assert the useful type at the consumer as well as whether the program is accepted. A value can retain an acceptable outer container type while losing essential element information.

Choose the consumer according to the lost fact: shape/arity can matter to fixed-shape parameters and boundary access; element type or optionality can matter to arithmetic, member access, and required arguments; correlations can matter to branches and return types. A comparison test does not establish coverage of element arithmetic, and an exact-type assertion does not establish that an ordinary consumer still works. Separate their probes when either has an independent failure mode.

Vary representations when they reach different code paths: inferred versus annotated values, fresh literals versus existing aliases, fixed versus generic forms, and boundary cardinalities. Derive the expected result from the language contract before comparing the builds. Do not interpret every precision loss as a bug; separate intended policy changes, unjustified assumptions, and demonstrated regressions.

## Close gaps without an arbitrary test quota

Before concluding, reconcile the selected hypotheses with the coverage record:

- Every semantic change in the initial inventory has a hypothesis and relevant consumer coverage, or an explicit exclusion/remaining gap. Do not limit this audit to hypotheses already represented by tests.
- Every selected combination is executed, excluded with a reason tied to code or semantics, or explicitly untested. A failed run is untested, not a pass.
- Both newly accepted and newly rejected programs are assessed. A baseline failure does not automatically remove an in-scope incomplete fix.
- Newly discovered triggering patterns have relevant variants and controls, or explicit remaining gaps.
- The final report and draft include the distinct actionable findings supported by the evidence; raw case volume is not a substitute for that inventory.

Spend a focused second pass on uncovered interactions and questionable oracles. This can be done by the current reviewer; a separate reviewer is optional when the task permits it. Its input should be the diff, coverage record, sources, and raw results, and its task should be to challenge claims and execute missing cases. Do not replace this with an unbounded repeat of the same review.

If reviewing review quality, distinguish a missing generated case, failed execution, incorrect expectation, classification error, reporting omission, and unavailable evidence. An absent final finding alone does not establish which stage failed. Preserve that uncertainty rather than claiming a discovery improvement from more reported items.

## Classify the individual obligation

Record observation, interpretation, and reporting disposition separately. Use exact diagnostic locations/rules or inferred types for the claimed operation; whole-file error counts are insufficient.

| Evidence | Supported interpretation |
|---|---|
| A valid consumer is accepted before and rejected after; setup is valid on both | Introduced rejection, subject to the independent contract or documented policy |
| An invalid operation has its relevant baseline diagnostic and loses it on the head | Introduced diagnostic loss; similar baseline weaknesses elsewhere do not erase that change |
| Both revisions reject the file, but only the head rejects the relevant consumer | Possible consumer regression hidden by another baseline error; isolate and rerun before classifying |
| Baseline rejects only setup; head accepts setup and an unsafe-looking consumer | No demonstrated loss of a consumer diagnostic yet; establish a valid baseline context, or label the observation differently |
| An exact-type assertion fails on both, while a different consumer newly fails | Separate the assertion and consumer; do not classify by the original whole-file result |
| Runtime fails through an explicitly dynamic type, or inference deliberately loses precision | Establish the applicable static contract; runtime failure alone is insufficient. Retain a material in-scope tradeoff or unresolved question with its qualification |

When minimizing, preserve originals and independently rerun changed sources on both revisions. Do not erase inconvenient baseline diagnostics, rewrite the oracle to match the candidate, or retroactively count a failed run as completed. If a policy consequence was explored but not treated as a bug, keep its observed behavior and the reason for that judgment in the local report; include it in PR feedback only when material to the change and clearly qualified.
