import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

const cases = [
    { element: 'Plain', shortcut: true, accepted: false },
    { element: 'int', shortcut: true, accepted: false },
    { element: 'Plain | Other', shortcut: true, accepted: false },
    { element: 'Plain | Callable[[], int]', shortcut: true, accepted: false },
    { element: 'Good', shortcut: false, accepted: true },
    { element: 'Good | Plain', shortcut: false, accepted: false },
    { element: 'Nested', shortcut: false, accepted: false },
    { element: 'Dynamic', shortcut: false },
    { element: 'AttributeAccess', shortcut: false },
    { element: 'UncertainBase', shortcut: false },
    { element: 'Generic[T]', shortcut: false, accepted: false },
    { element: 'Generic[int]', shortcut: true, accepted: false },
    { element: 'InheritedPlain', shortcut: true, accepted: false },
    { element: 'CallableObject', shortcut: true, accepted: false },
    { element: 'InheritedGood', shortcut: false, accepted: true },
    { element: 'InheritedDynamic', shortcut: false },
    { element: 'IndexOnly', shortcut: false, accepted: false },
    { element: 'Plain | Any', shortcut: false },
    { element: 'Plain | Dynamic', shortcut: false },
    { element: 'Plain | T', shortcut: false, accepted: false },
    { element: 'Generic[list[T]]', shortcut: false, accepted: false },
    { element: 'Generic[list[int]]', shortcut: true, accepted: false },
    { element: 'Record', shortcut: false, accepted: false },
    { element: 'UnrelatedProtocol', shortcut: false, accepted: false },
    { element: 'type[Plain]', shortcut: false, accepted: false },
];

test.each(cases)('ProtocolRequirementInstances $element', ({ element, shortcut, accepted }) => {
    const run = (diagnostics: boolean) => {
        const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Any, Protocol, TypedDict, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// class Plain: pass
//// class Other: pass
//// class Good:
////     def serialize(self) -> int: ...
//// class Nested:
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> Good: ...
////     def __iter__(self, /) -> Iterator[Good]: ...
//// class Dynamic:
////     def __getattr__(self, name: str) -> Any: ...
//// class AttributeAccess:
////     def __getattribute__(self, name: str) -> Any: ...
//// class UncertainBase(Missing): pass
//// class Generic[Value]: pass
//// class InheritedPlain(Plain): pass
//// class CallableObject:
////     def __call__(self, value: int) -> str: ...
//// class InheritedGood(Good): pass
//// class InheritedDynamic(Dynamic): pass
//// class IndexOnly:
////     def __getitem__(self, index: int) -> Good: ...
//// class Record(TypedDict):
////     value: int
//// class UnrelatedProtocol(Protocol):
////     def unrelated(self) -> int: ...
//// def check[T](source: list[${element}], destination: NestedSequence[Leaf[T]], variable: T):
////     /*source*/source
////     /*destination*/destination
////     /*variable*/variable
        `).state;
        const evaluator = state.program.evaluator!;
        const typeAt = (marker: string) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            return evaluator.getTypeOfExpression(node).type;
        };
        const source = typeAt('source');
        const destination = typeAt('destination');
        const variable = typeAt('variable');
        assert.ok(isClassInstance(source) && isClassInstance(destination) && isTypeVar(variable));
        const freeVariable = variable.priv.freeTypeVar;
        assert.ok(freeVariable?.priv.scopeId);
        const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(destination), [freeVariable.priv.scopeId]);
        const constraints = new ConstraintTracker();
        constraints.getMainConstraintSet().addScopeId('caller');
        const observe = () => ({
            solved: evaluator.printType(evaluator.solveAndApplyConstraints(freeVariable, constraints)),
            sets: constraints.getConstraintSets().map((set) => ({
                scopes: [...set.getScopeIds()],
                bounds: set.getTypeVars().map((entry) => ({
                    lower: entry.lowerBound && evaluator.printType(entry.lowerBound),
                    upper: entry.upperBound && evaluator.printType(entry.upperBound),
                    retain: entry.retainLiterals,
                })),
            })),
        });
        const before = observe();
        assert.strictEqual(
            tryFastRejectSequenceProtocol(evaluator, target, source, constraints, AssignTypeFlags.Default, 0),
            shortcut ? '__getitem__' : undefined
        );
        assert.deepStrictEqual(observe(), before);
        const results = [];
        for (let repetition = 0; repetition < 2; repetition++) {
            const result = assignClassToProtocol(
                evaluator,
                target,
                source,
                diagnostics ? new DiagnosticAddendum() : undefined,
                constraints,
                AssignTypeFlags.Default,
                0
            );
            if (element === 'Nested') {
                assert.strictEqual(result, repetition > 0);
                assert.strictEqual(observe().solved, 'int');
            } else if (accepted !== undefined) {
                assert.strictEqual(result, accepted);
            }
            if (accepted) {
                assert.strictEqual(observe().solved, 'int');
            }
            if (shortcut) {
                assert.deepStrictEqual(observe(), before);
            }
            results.push({ result, state: observe() });
        }
        return results;
    };
    assert.deepStrictEqual(run(false), run(true));
});
