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
