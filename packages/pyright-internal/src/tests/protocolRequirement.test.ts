import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, combineTypes, isClassInstance, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test('ProtocolRequirementOverloadSelection', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['protocolRequirementOverloads.py']);
    TestUtils.validateResults(results, 0);
});

test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
])('ProtocolMissingCapabilityCallerState diagnostics=%s iteratorFirst=%s', (diagnostics, iteratorFirst) => {
    const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar, overload
//// T_co = TypeVar("T_co", covariant=True)
//// class SupportsArray(Protocol[T_co]):
////     def __array__(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
${iteratorFirst ? '////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...' : ''}
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
${iteratorFirst ? '' : '////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...'}
//// @overload
//// def first(value: int) -> int: ...
//// @overload
//// def first(value: str) -> str: ...
//// def first(value: int | str) -> int | str:
////     return value
//// def check[T](variable: T, destination: NestedSequence[SupportsArray[T]]):
////     @overload
////     def second(value: T) -> T: ...
////     @overload
////     def second(value: str) -> str: ...
////     def second(value: T | str) -> T | str:
////         return value
////     /*first*/first
////     /*second*/second
////     /*source*/[first, second]
////     /*destination*/destination
////     /*variable*/variable
    `).state;
    const evaluator = state.program.evaluator!;
    const sourceNode = getNodeAtMarker(state, 'source');
    const destinationNode = getNodeAtMarker(state, 'destination');
    const variableNode = getNodeAtMarker(state, 'variable');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(variableNode.nodeType, ParseNodeType.Name);
    const source = evaluator.getTypeOfExpression(sourceNode).type;
    const destination = evaluator.getTypeOfExpression(destinationNode).type;
    const variable = evaluator.getTypeOfExpression(variableNode).type;
    assert.ok(isClassInstance(source));
    assert.ok(isClassInstance(destination));
    assert.ok(isTypeVar(variable));
    const freeVariable = variable.priv.freeTypeVar;
    assert.ok(freeVariable?.priv.scopeId);
    const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(destination), [freeVariable.priv.scopeId]);
    const firstNode = getNodeAtMarker(state, 'first');
    const secondNode = getNodeAtMarker(state, 'second');
    assert.strictEqual(firstNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(secondNode.nodeType, ParseNodeType.Name);
    const sourceType = makeTypeVarsFree(
        ClassType.specialize(source, [
            combineTypes([
                evaluator.getTypeOfExpression(firstNode).type,
                evaluator.getTypeOfExpression(secondNode).type,
            ]),
        ]),
        [freeVariable.priv.scopeId]
    );
    const constraints = new ConstraintTracker();
    constraints.getMainConstraintSet().addScopeId('caller');
    const originalType = evaluator.printType(sourceType);
    assert.ok(originalType.includes('Overload['));
    assert.strictEqual(
        assignClassToProtocol(
            evaluator,
            target,
            sourceType,
            diagnostics ? new DiagnosticAddendum() : undefined,
            constraints,
            AssignTypeFlags.Default,
            0
        ),
        false
    );
    expect(
        constraints.getConstraintSets().map((set) => ({
            scopes: [...set.getScopeIds()],
            bindings: set.getTypeVars(),
        }))
    ).toEqual([{ scopes: ['caller'], bindings: [] }]);
    assert.strictEqual(evaluator.printType(sourceType), originalType);
});
