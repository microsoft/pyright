import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isTypeVar } from '../analyzer/types';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

describe.each(['Plain', 'Callable[[], int]', 'int'])('ProtocolRequirementSpeculative %s', (element) => {
    test.each(
        [AssignTypeFlags.Default, AssignTypeFlags.RetainLiteralsForTypeVar].flatMap((flags) =>
            [false, true].flatMap((multipleSets) =>
                [false, true].flatMap((positiveFirst) =>
                    [false, true].map((populated) => ({ flags, multipleSets, positiveFirst, populated }))
                )
            )
        )
    )(
        'flags=$flags multipleSets=$multipleSets positiveFirst=$positiveFirst populated=$populated',
        ({ flags, multipleSets, positiveFirst, populated }) => {
            const run = (speculative: boolean) => {
                const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Literal, Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol):
////     def serialize(self) -> int: ...
//// class Plain: pass
//// class Good:
////     def serialize(self) -> int: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check[T](variable: T, literal: Literal[7], other: Literal[8], integer: int, source: list[${element}], destination: NestedSequence[${
                    element === 'int' ? 'str' : 'Leaf'
                }], valid: list[${element === 'int' ? 'str' : 'Good'}]):
////     /*source*/source
////     /*destination*/destination
////     /*valid*/valid
////     /*variable*/variable
////     /*literal*/literal
////     /*other*/other
////     /*integer*/integer
            `).state;
                const evaluator = state.program.evaluator!;
                const typeAt = (marker: string) => {
                    const node = getNodeAtMarker(state, marker);
                    assert.strictEqual(node.nodeType, ParseNodeType.Name);
                    const type = evaluator.getTypeOfExpression(node).type;
                    assert.ok(isClassInstance(type));
                    return type;
                };
                const source = typeAt('source');
                const target = ClassType.cloneAsInstantiable(typeAt('destination'));
                const valid = typeAt('valid');
                const accepted = ClassType.specialize(target, [source.priv.typeArgs![0]]);
                const constraints = new ConstraintTracker();
                const variableNode = getNodeAtMarker(state, 'variable');
                assert.strictEqual(variableNode.nodeType, ParseNodeType.Name);
                const variable = evaluator.getTypeOfExpression(variableNode).type;
                assert.ok(isTypeVar(variable) && variable.priv.freeTypeVar);
                const freeVariable = variable.priv.freeTypeVar;
                if (populated) {
                    constraints.setBounds(freeVariable, typeAt('literal'), typeAt('integer'), false);
                }
                constraints.getMainConstraintSet().addScopeId('caller');
                if (multipleSets) {
                    const other = constraints.getMainConstraintSet().clone();
                    other.addScopeId('alternative');
                    if (populated) {
                        other.setBounds(freeVariable, typeAt('other'), typeAt('integer'), true);
                    }
                    constraints.addConstraintSets([constraints.getMainConstraintSet(), other]);
                }
                const observe = () => ({
                    source: evaluator.printType(source),
                    sets: constraints.getConstraintSets().map((set) => ({
                        scopes: [...set.getScopeIds()],
                        bounds: set.getTypeVars().map((entry) => ({
                            variable: evaluator.printType(entry.typeVar),
                            lower: entry.lowerBound && evaluator.printType(entry.lowerBound),
                            upper: entry.upperBound && evaluator.printType(entry.upperBound),
                            retain: entry.retainLiterals,
                        })),
                    })),
                });
                const before = observe();
                const assign = (destination: ClassType, input = source, details = new DiagnosticAddendum()) =>
                    assignClassToProtocol(evaluator, destination, input, details, constraints, flags, 0);
                if (positiveFirst) {
                    assert.strictEqual(assign(accepted), true);
                    assert.deepStrictEqual(observe(), before);
                }
                const observations: ReturnType<typeof observe>[] = [];
                const reject = () => {
                    assert.strictEqual(evaluator.isSpeculativeModeInUse(undefined), speculative);
                    assert.strictEqual(assign(target), false);
                    assert.deepStrictEqual(observe(), before);
                    observations.push(observe());
                };
                if (speculative) {
                    evaluator.useSpeculativeMode(getNodeAtMarker(state, 'source'), () => {
                        reject();
                        evaluator.useSpeculativeMode(getNodeAtMarker(state, 'destination'), reject);
                        reject();
                    });
                } else {
                    reject();
                    reject();
                    reject();
                }
                assert.strictEqual(evaluator.isSpeculativeModeInUse(undefined), false);
                const details = new DiagnosticAddendum();
                assert.strictEqual(assign(target, source, details), false);
                assert.ok(details.getString().length > 0);
                assert.strictEqual(assign(accepted), true);
                assert.strictEqual(assign(target, valid), true);
                assert.deepStrictEqual(observe(), before);
                observations.push(observe());
                return { observations, diagnostic: details.getString() };
            };
            assert.deepStrictEqual(run(true), run(false));
        }
    );
});

test.each([false, true])('ProtocolRequirementExceptionUnwind speculative=%s', (speculative) => {
    const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check(source: list[int], destination: NestedSequence[str]):
////     /*source*/source
////     /*destination*/destination
    `).state;
    const evaluator = state.program.evaluator!;
    const typeAt = (marker: string) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        const type = evaluator.getTypeOfExpression(node).type;
        assert.ok(isClassInstance(type));
        return type;
    };
    const source = typeAt('source');
    const target = ClassType.cloneAsInstantiable(typeAt('destination'));
    evaluator.inferVarianceForClass(target);
    const constraints = new ConstraintTracker();
    constraints.getMainConstraintSet().addScopeId('caller');
    const assign = (destination = target) =>
        assignClassToProtocol(evaluator, destination, source, undefined, constraints, AssignTypeFlags.Default, 0);
    const failure = new Error('Injected protocol member lookup failure');
    const spy = jest.spyOn(evaluator, 'getDeclaredTypeOfSymbol').mockImplementationOnce(() => {
        throw failure;
    });
    try {
        assert.throws(
            () => {
                if (speculative) {
                    evaluator.useSpeculativeMode(getNodeAtMarker(state, 'source'), () =>
                        evaluator.useSpeculativeMode(getNodeAtMarker(state, 'destination'), () => assign())
                    );
                } else {
                    assign();
                }
            },
            (error: unknown) => error === failure
        );
        assert.strictEqual(spy.mock.calls.length, 1);
    } finally {
        spy.mockRestore();
    }
    assert.strictEqual(evaluator.isSpeculativeModeInUse(undefined), false);
    assert.strictEqual(assign(), false);
    assert.strictEqual(assign(ClassType.specialize(target, [source.priv.typeArgs![0]])), true);
    assert.strictEqual(assign(), false);
    assert.deepStrictEqual(
        constraints.getConstraintSets().map((set) => ({ scopes: [...set.getScopeIds()], bounds: set.getTypeVars() })),
        [{ scopes: ['caller'], bounds: [] }]
    );
});
