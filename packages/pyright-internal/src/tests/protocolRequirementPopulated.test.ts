import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

test.each(
    ['generic', 'concrete', 'callable'].flatMap((targetKind) =>
        ['literal', 'integer', 'none', 'empty'].map((upper) => ({ targetKind, upper }))
    )
)('ProtocolRequirementPopulated target=$targetKind upper=$upper', ({ targetKind, upper }) => {
    const rejectedAnnotation =
        targetKind === 'generic' ? 'Leaf[T]' : targetKind === 'concrete' ? 'Leaf[int]' : 'Callable[[], str]';
    const run = (diagnostics: boolean) => {
        const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Literal, Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check[T](source: list[Callable[[], int]], rejected: NestedSequence[${rejectedAnnotation}], accepted: NestedSequence[Callable[[], int]], variable: T, literal: Literal[7], other: Literal[8], integer: int, text: str, container: list[T]):
////     /*source*/source
////     /*rejected*/rejected
////     /*accepted*/accepted
////     /*variable*/variable
////     /*literal*/literal
////     /*other*/other
////     /*integer*/integer
////     /*text*/text
////     /*container*/container
        `).state;
        const evaluator = state.program.evaluator!;
        const typeAt = (marker: string) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            return evaluator.getTypeOfExpression(node).type;
        };
        const source = typeAt('source');
        const rejected = typeAt('rejected');
        const accepted = typeAt('accepted');
        const variable = typeAt('variable');
        assert.ok(isClassInstance(source) && isClassInstance(rejected) && isClassInstance(accepted));
        assert.ok(isTypeVar(variable));
        const freeVariable = variable.priv.freeTypeVar;
        assert.ok(freeVariable?.priv.scopeId);
        const scopes = [freeVariable.priv.scopeId];
        const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(rejected), scopes);
        const container = makeTypeVarsFree(typeAt('container'), scopes);
        const initial = new ConstraintTracker();
        if (upper !== 'empty') {
            initial.setBounds(freeVariable, typeAt('literal'), upper === 'none' ? undefined : typeAt(upper), false);
        }
        initial.getMainConstraintSet().addScopeId('caller');
        const observe = (tracker: ConstraintTracker) => ({
            solved: evaluator.printType(evaluator.solveAndApplyConstraints(freeVariable, tracker)),
            nested: evaluator.printType(evaluator.solveAndApplyConstraints(container, tracker)),
            score: tracker.getScore(),
            sets: tracker.getConstraintSets().map((set) => ({
                scopes: [...set.getScopeIds()],
                bounds: set.getTypeVars().map((entry) => ({
                    lower: entry.lowerBound && evaluator.printType(entry.lowerBound),
                    upper: entry.upperBound && evaluator.printType(entry.upperBound),
                    retain: entry.retainLiterals,
                })),
            })),
        });
        const before = observe(initial);
        assert.strictEqual(
            tryFastRejectSequenceProtocol(evaluator, target, source, initial, AssignTypeFlags.Default, 0),
            targetKind === 'generic' && upper !== 'empty' ? undefined : '__getitem__'
        );
        assert.deepStrictEqual(observe(initial), before);
        const results = [];
        for (const warm of [false, true]) {
            const constraints = initial.clone();
            if (warm) {
                constraints.getMainConstraintSet().addScopeId('second');
            }
            const diagnostic = diagnostics ? new DiagnosticAddendum() : undefined;
            for (let repetition = 0; repetition < 2; repetition++) {
                assert.strictEqual(
                    assignClassToProtocol(
                        evaluator,
                        target,
                        source,
                        diagnostic,
                        constraints,
                        AssignTypeFlags.Default,
                        0
                    ),
                    false
                );
                const observation = observe(constraints);
                if (upper !== 'empty') {
                    assert.strictEqual(observation.solved, upper === 'literal' ? 'Literal[7]' : 'int');
                }
                if (targetKind !== 'generic' || upper === 'empty') {
                    assert.deepStrictEqual(observation, {
                        ...before,
                        sets: before.sets.map((set) => ({
                            ...set,
                            scopes: warm ? [...set.scopes, 'second'] : set.scopes,
                        })),
                    });
                }
                results.push(observation);
            }
            for (const flags of [AssignTypeFlags.Default, AssignTypeFlags.Invariant, AssignTypeFlags.Contravariant]) {
                for (const transfer of ['clone', 'signature', 'copy', 'bounds']) {
                    let continued = constraints.clone();
                    if (transfer === 'signature') {
                        continued = constraints.cloneWithSignature('caller');
                    } else if (transfer === 'copy') {
                        continued.copyFromClone(constraints);
                    } else if (transfer === 'bounds') {
                        continued = new ConstraintTracker();
                        continued.copyBounds(constraints.getMainConstraintSet().getTypeVar(freeVariable)!);
                    }
                    for (const marker of ['literal', 'other', 'integer', 'text']) {
                        results.push({
                            assigned: evaluator.assignType(freeVariable, typeAt(marker), undefined, continued, flags),
                            observation: observe(continued),
                        });
                    }
                }
            }
            assert.strictEqual(
                assignClassToProtocol(
                    evaluator,
                    ClassType.cloneAsInstantiable(accepted),
                    source,
                    undefined,
                    constraints,
                    AssignTypeFlags.Default,
                    0
                ),
                true
            );
            results.push(observe(constraints));
        }
        return results;
    };
    assert.deepStrictEqual(run(false), run(true));
});
