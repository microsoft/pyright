/*
 * constraintSolver.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for the constraint solver.
 */

import assert from 'assert';

import { getEnclosingFunction } from '../analyzer/parseTreeUtils';
import { FunctionType, TypeVarType, isTypeVar } from '../analyzer/types';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

test('Recursive source must satisfy the TypeVar bound without a constraint tracker', () => {
    const code = `
// @filename: test.py
//// class Foo: ...
//// class Box[T]: ...
//// class FooBox[T](Foo): ...
////
//// def /*marker*/func[T: Foo](dest: T, unrelated: Box[T], bounded: FooBox[T]) -> None: ...
    `;

    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;

    const node = getNodeAtMarker(state, 'marker');
    assert(node.nodeType === ParseNodeType.Name);

    const functionNode = getEnclosingFunction(node);
    assert(functionNode?.nodeType === ParseNodeType.Function);

    const functionType = evaluator.getTypeOfFunction(functionNode)?.functionType;
    assert(functionType);

    const [destType, unrelatedType, boundedType] = [0, 1, 2].map((index) =>
        FunctionType.getParamType(functionType, index)
    );
    assert(isTypeVar(destType) && !TypeVarType.isBound(destType));

    assert.strictEqual(evaluator.assignType(destType, unrelatedType), false);
    assert.strictEqual(evaluator.assignType(destType, boundedType), true);
});
