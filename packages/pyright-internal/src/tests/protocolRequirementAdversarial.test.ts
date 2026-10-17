import * as assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isFunction } from '../analyzer/types';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

test.each([false, true])('ProtocolRequirementCustomFunctionCapability diagnostics=%s', (diagnostics) => {
    const typesStub = readFileSync(resolve(__dirname, '../../typeshed-fallback/stdlib/types.pyi'), 'utf8');
    assert.ok(typesStub.includes('class FunctionType:'));
    const augmentedStub = typesStub.replace(
        'class FunctionType:',
        'class FunctionType:\n    def __array__(self) -> int: ...'
    );
    const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/types.pyi
${augmentedStub
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class SupportsArray(Protocol[T_co]):
////     def __array__(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def operation(value: int) -> int:
////     return value
//// def check(destination: NestedSequence[SupportsArray[int]], leaf: SupportsArray[int]):
////     /*operation*/operation
////     /*source*/[operation]
////     /*destination*/destination
////     /*leaf*/leaf
    `).state;
    const evaluator = state.program.evaluator!;
    const sourceNode = getNodeAtMarker(state, 'source');
    const destinationNode = getNodeAtMarker(state, 'destination');
    const operationNode = getNodeAtMarker(state, 'operation');
    const leafNode = getNodeAtMarker(state, 'leaf');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(operationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(leafNode.nodeType, ParseNodeType.Name);
    const source = evaluator.getTypeOfExpression(sourceNode).type;
    const destination = evaluator.getTypeOfExpression(destinationNode).type;
    const operation = evaluator.getTypeOfExpression(operationNode).type;
    const leaf = evaluator.getTypeOfExpression(leafNode).type;
    assert.ok(isClassInstance(source));
    assert.ok(isClassInstance(destination));
    assert.ok(isFunction(operation));
    assert.ok(evaluator.assignType(leaf, operation), 'The custom function stub must supply the array capability');
    const details = diagnostics ? new DiagnosticAddendum() : undefined;
    assert.strictEqual(
        assignClassToProtocol(
            evaluator,
            ClassType.cloneAsInstantiable(destination),
            ClassType.specialize(source, [operation]),
            details,
            new ConstraintTracker(),
            AssignTypeFlags.Default,
            0
        ),
        true,
        details?.getString()
    );
});
