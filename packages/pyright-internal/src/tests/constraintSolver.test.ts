/*
 * constraintSolver.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for the constraint solver.
 */

import assert from 'assert';

import { getEnclosingFunction } from '../analyzer/parseTreeUtils';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import {
    AnyType,
    combineTypes,
    FunctionType,
    isTypeSame,
    isTypeVar,
    isUnion,
    Type,
    TypeBase,
    TypeVarScopeType,
    TypeVarType,
    UnknownType,
} from '../analyzer/types';
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

test.each([
    AssignTypeFlags.Default,
    AssignTypeFlags.Invariant,
    AssignTypeFlags.Contravariant,
    AssignTypeFlags.OverloadOverlap,
])('Equivalent TypeVar union arms retain TypeForm metadata during assignment: %s', (flags) => {
    const state = parseAndGetTestState(`
// @filename: test.py
//// def /*marker*/func(value: int) -> None: ...
    `).state;
    const evaluator = state.program.evaluator!;
    const node = getNodeAtMarker(state, 'marker');
    const functionNode = getEnclosingFunction(node);
    assert(functionNode);
    const functionType = evaluator.getTypeOfFunction(functionNode)?.functionType;
    assert(functionType);
    const intType = FunctionType.getParamType(functionType, 0);
    const free = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'caller',
        'caller',
        TypeVarScopeType.Function
    );
    const bound = TypeVarType.cloneAsBound(free);
    const unrelated = TypeVarType.cloneAsBound(
        TypeVarType.cloneForScopeId(TypeVarType.createInstance('T'), 'other', 'other', TypeVarScopeType.Function)
    );

    for (const dest of [bound, free]) {
        const tagged = TypeBase.cloneWithTypeForm(dest, dest);
        assert.ok(isTypeSame(dest, tagged));
        assert.ok(!isTypeSame(dest, tagged, { honorTypeForm: true }));

        for (const gradual of [undefined, AnyType.create(), UnknownType.create()]) {
            const arms: Type[] = gradual ? [gradual, dest, tagged] : [dest, tagged];
            for (const ordered of [arms, [...arms].reverse()]) {
                const source = combineTypes(ordered);
                assert.ok(isUnion(source));
                assert.strictEqual(source.priv.subtypes.length, arms.length);
                assert.strictEqual(evaluator.assignType(dest, source, undefined, undefined, flags), true);
                assert.strictEqual(tagged.props?.typeForm, dest);
                assert.strictEqual(dest.props?.typeForm, undefined);
                assert.strictEqual(source.priv.subtypes.length, arms.length);
            }
        }
    }

    for (const incompatible of [unrelated, intType, TypeVarType.cloneAsInstantiable(bound)]) {
        const tagged = TypeBase.cloneWithTypeForm(bound, bound);
        for (const gradual of [AnyType.create(), UnknownType.create()]) {
            const source = combineTypes([gradual, bound, tagged, incompatible]);
            assert.strictEqual(evaluator.assignType(bound, source, undefined, undefined, flags), false);
        }
    }
});
