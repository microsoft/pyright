import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance } from '../analyzer/types';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

describe.each(['Plain', 'Callable[[], int]', 'int'])('ProtocolRequirementSpeculative %s', (element) => {
    test.each(
        [AssignTypeFlags.Default, AssignTypeFlags.RetainLiteralsForTypeVar].flatMap((flags) =>
            [false, true].flatMap((multipleSets) =>
                [false, true].map((positiveFirst) => ({ flags, multipleSets, positiveFirst }))
            )
        )
    )(
        'flags=$flags multipleSets=$multipleSets positiveFirst=$positiveFirst',
        ({ flags, multipleSets, positiveFirst }) => {
            const run = (speculative: boolean) => {
                const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Protocol, TypeVar
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
//// def check(source: list[${element}], destination: NestedSequence[${
                    element === 'int' ? 'str' : 'Leaf'
                }], valid: list[${element === 'int' ? 'str' : 'Good'}]):
////     /*source*/source
////     /*destination*/destination
////     /*valid*/valid
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
                constraints.getMainConstraintSet().addScopeId('caller');
                if (multipleSets) {
                    const other = constraints.getMainConstraintSet().clone();
                    other.addScopeId('alternative');
                    constraints.addConstraintSets([constraints.getMainConstraintSet(), other]);
                }
                const observe = () => ({
                    source: evaluator.printType(source),
                    sets: constraints.getConstraintSets().map((set) => ({
                        scopes: [...set.getScopeIds()],
                        bounds: set.getTypeVars(),
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
