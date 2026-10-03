import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance } from '../analyzer/types';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

describe.each(['RecursiveList', 'SelfOnly', 'MutualLeft'])('ProtocolRequirementCycles %s', (element) => {
    test.each(['shortcut', 'cold', 'diagnostic'])('%s', (mode) => {
        const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// type RecursiveList = list[RecursiveList]
//// class SelfOnly:
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> "SelfOnly": ...
////     def __iter__(self, /) -> Iterator["SelfOnly"]: ...
//// class MutualLeft:
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> "MutualRight": ...
////     def __iter__(self, /) -> Iterator["MutualRight"]: ...
//// class MutualRight:
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> MutualLeft: ...
////     def __iter__(self, /) -> Iterator[MutualLeft]: ...
//// def check(source: list[${element}], destination: NestedSequence[Leaf[int]]):
////     /*source*/source
////     /*destination*/destination
        `).state;
        const evaluator = state.program.evaluator!;
        const typeAt = (marker: string) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            return evaluator.getTypeOfExpression(node).type;
        };
        const source = typeAt('source');
        const destination = typeAt('destination');
        assert.ok(isClassInstance(source) && isClassInstance(destination));
        const target = ClassType.cloneAsInstantiable(destination);
        const constraints = new ConstraintTracker();
        constraints.getMainConstraintSet().addScopeId('caller');
        const sourceBefore = evaluator.printType(source);
        for (let repetition = 0; repetition < 2; repetition++) {
            if (mode === 'shortcut') {
                assert.strictEqual(
                    tryFastRejectSequenceProtocol(evaluator, target, source, constraints, AssignTypeFlags.Default, 0),
                    undefined
                );
            } else {
                assert.strictEqual(
                    assignClassToProtocol(
                        evaluator,
                        target,
                        source,
                        mode === 'diagnostic' ? new DiagnosticAddendum() : undefined,
                        constraints,
                        AssignTypeFlags.Default,
                        0
                    ),
                    true
                );
            }
            assert.strictEqual(evaluator.printType(source), sourceBefore);
            assert.deepStrictEqual(
                constraints.getConstraintSets().map((set) => ({
                    scopes: [...set.getScopeIds()],
                    bounds: set.getTypeVars(),
                })),
                [{ scopes: ['caller'], bounds: [] }]
            );
        }
    });
});

test.each([false, true])('ProtocolRequirementFailedRecursiveAncestor speculative=%s', (speculative) => {
    const run = (warm: boolean) => {
        const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// type RecursiveList = list[RecursiveList | float]
//// def check(outer: list[RecursiveList], inner: RecursiveList, bad: NestedSequence[int], good: NestedSequence[float]):
////     /*outer*/outer
////     /*inner*/inner
////     /*bad*/bad
////     /*good*/good
        `).state;
        const evaluator = state.program.evaluator!;
        const typeAt = (marker: string) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            const type = evaluator.getTypeOfExpression(node).type;
            assert.ok(isClassInstance(type));
            return type;
        };
        const outer = typeAt('outer');
        const inner = typeAt('inner');
        const bad = ClassType.cloneAsInstantiable(typeAt('bad'));
        const good = ClassType.cloneAsInstantiable(typeAt('good'));
        const constraints = new ConstraintTracker();
        constraints.getMainConstraintSet().addScopeId('caller');
        const before = [evaluator.printType(outer), evaluator.printType(inner)];
        const assign = (destination: ClassType, source: ClassType, diagnostic?: DiagnosticAddendum): boolean =>
            assignClassToProtocol(evaluator, destination, source, diagnostic, constraints, AssignTypeFlags.Default, 0);
        if (warm) {
            const reject = () => assert.strictEqual(assign(bad, outer), false);
            if (speculative) {
                evaluator.useSpeculativeMode(getNodeAtMarker(state, 'outer'), reject);
            } else {
                reject();
            }
        }
        assert.strictEqual(evaluator.isSpeculativeModeInUse(undefined), false);
        for (let repetition = 0; repetition < 2; repetition++) {
            assert.strictEqual(assign(bad, inner), false);
            assert.strictEqual(assign(good, inner), true);
            assert.strictEqual(assign(good, outer), true);
        }
        const diagnostic = new DiagnosticAddendum();
        assert.strictEqual(assign(bad, inner, diagnostic), false);
        assert.ok(diagnostic.getString().length > 0);
        assert.deepStrictEqual([evaluator.printType(outer), evaluator.printType(inner)], before);
        assert.deepStrictEqual(
            constraints
                .getConstraintSets()
                .map((set) => ({ scopes: [...set.getScopeIds()], bounds: set.getTypeVars() })),
            [{ scopes: ['caller'], bounds: [] }]
        );
        return diagnostic.getString();
    };
    assert.strictEqual(run(true), run(false));
});
