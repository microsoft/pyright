import * as assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isFunctionOrOverloaded } from '../analyzer/types';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

const cases = ['plain', 'overloaded', 'instance.method', 'instance.overloaded_method'].flatMap((expression) =>
    [false, true].flatMap((capability) =>
        [false, true].flatMap((diagnostics) =>
            [false, true].map((warm) => ({ expression, capability, diagnostics, warm }))
        )
    )
);

test.each(cases)(
    'ProtocolRequirementBoundary $expression capability=$capability diagnostics=$diagnostics warm=$warm',
    ({ expression, capability, diagnostics, warm }) => {
        let typesStub = readFileSync(resolve(__dirname, '../../typeshed-fallback/stdlib/types.pyi'), 'utf8');
        if (capability) {
            const className = expression.startsWith('instance.') ? 'MethodType' : 'FunctionType';
            assert.ok(typesStub.includes(`class ${className}:`));
            typesStub = typesStub.replace(
                `class ${className}:`,
                `class ${className}:\n    def __array__(self) -> int: ...`
            );
        }
        const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/types.pyi
${typesStub
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar, overload
//// T_co = TypeVar("T_co", covariant=True)
//// class SupportsArray(Protocol[T_co]):
////     def __array__(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def plain(value: int) -> int:
////     return value
//// @overload
//// def overloaded(value: int) -> int: ...
//// @overload
//// def overloaded(value: str) -> str: ...
//// def overloaded(value: int | str) -> int | str:
////     return value
//// class Operations:
////     def method(self, value: int) -> int:
////         return value
////     @overload
////     def overloaded_method(self, value: int) -> int: ...
////     @overload
////     def overloaded_method(self, value: str) -> str: ...
////     def overloaded_method(self, value: int | str) -> int | str:
////         return value
//// def check(instance: Operations, destination: NestedSequence[SupportsArray[int]], leaf: SupportsArray[int]):
////     operation = ${expression}
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
        assert.ok(isFunctionOrOverloaded(operation));
        const sourceType = ClassType.specialize(source, [operation]);
        const originalSource = evaluator.printType(sourceType);
        const target = ClassType.cloneAsInstantiable(destination);
        const assign = (details: DiagnosticAddendum | undefined) =>
            assignClassToProtocol(
                evaluator,
                target,
                sourceType,
                details,
                new ConstraintTracker(),
                AssignTypeFlags.Default,
                0
            );
        if (warm) {
            assert.strictEqual(assign(new DiagnosticAddendum()), capability);
        }
        assert.strictEqual(assign(diagnostics ? new DiagnosticAddendum() : undefined), capability);
        assert.strictEqual(evaluator.assignType(leaf, operation), capability);
        assert.strictEqual(evaluator.printType(sourceType), originalSource);
    }
);
