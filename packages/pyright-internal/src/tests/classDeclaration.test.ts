/*
 * classDeclaration.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test class detail's declaration
 */

import assert from 'assert';

import { isClassDeclaration, isSpecialBuiltInClassDeclaration } from '../analyzer/declaration';
import { getEnclosingFunction } from '../analyzer/parseTreeUtils';
import { isProperty } from '../analyzer/typeUtils';
import { TypeCategory, isClassInstance } from '../analyzer/types';
import { TextRange } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { Range } from './harness/fourslash/fourSlashTypes';
import { TestState, getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

test('regular class', () => {
    const code = `
// @filename: test.py
//// [|class /*marker*/A:
////     pass|]
    `;

    checkClassDetail(code);
});

test('Meta class', () => {
    const code = `
// @filename: test.py
//// [|class /*range*/MyMeta(type):
////     def __new__(cls, name, bases, dct):
////         return super().__new__(cls, name, bases, dct)|]
//// 
//// class MyClass(metaclass=MyMeta):
////     pass
//// 
//// /*marker*/E = MyMeta()
    `;

    checkClassDetail(code, '__class_MyMeta');
});

test('special built in class', () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// def foo(t: /*marker*/TypedDict): ...
    `;

    checkSpecialBuiltInClassDetail(code);
});

test('dynamic enum', () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// /*marker*/E = Enum('E', { 'One': 1 })
    `;

    checkNoDeclarationInClassDetail(code);
});

test('dynamic named tuple', () => {
    const code = `
// @filename: test.py
//// from typing import NamedTuple
//// /*marker*/N = NamedTuple("N", [('name', str)])
    `;

    checkNoDeclarationInClassDetail(code);
});

test('dynamic typed dict', () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// /*marker*/T = TypedDict("T", { "one": str })
    `;

    checkNoDeclarationInClassDetail(code);
});

test('dynamic new type', () => {
    const code = `
// @filename: test.py
//// from typing import NewType
//// /*marker*/I = NewType('I', int)
    `;

    checkNoDeclarationInClassDetail(code);
});

test('dynamic type', () => {
    const code = `
// @filename: test.py
//// /*marker*/D = type('D', (object,), {})
    `;

    checkNoDeclarationInClassDetail(code);
});

test('property', () => {
    const code = `
// @filename: test.py
//// class MyClass:
////     def __init__(self):
////         self._v = None
////     
////     @property
////     def /*getter*/value(self):
////         return self._v
////     
////     @value.setter
////     def /*setter*/value(self, value):
////         self._v = value
////     
////     @value.deleter
////     def /*deleter*/value(self):
////         del self._v
    `;

    const state = parseAndGetTestState(code).state;

    ['getter', 'setter', 'deleter'].forEach((marker) => {
        const node = getNodeAtMarker(state, marker);
        assert(node.nodeType === ParseNodeType.Name);

        const functionNode = getEnclosingFunction(node);
        assert(functionNode?.nodeType === ParseNodeType.Function);

        const result = state.program.evaluator!.getTypeOfFunction(functionNode);
        assert(result?.decoratedType);

        assert(isProperty(result.decoratedType));
        assert(isClassInstance(result.decoratedType));

        assert(result.decoratedType.shared.declaration);
        assert(isClassDeclaration(result.decoratedType.shared.declaration));

        assert(result.decoratedType.shared.declaration.moduleName === 'builtins');
        assert(result.decoratedType.shared.declaration.node.d.name.d.value === 'property');
    });
});

function checkSpecialBuiltInClassDetail(code: string) {
    const state = parseAndGetTestState(code).state;

    const node = getNodeAtMarker(state);
    assert(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert(type?.category === TypeCategory.Class);

    assert.strictEqual(node.d.value, type.priv.aliasName ?? type.shared.name);

    assert(type.shared.declaration);
    if (type.priv.aliasName) {
        assert(isClassDeclaration(type.shared.declaration));
    } else {
        assert(isSpecialBuiltInClassDeclaration(type.shared.declaration));
    }
}

function checkNoDeclarationInClassDetail(code: string) {
    const state = parseAndGetTestState(code).state;
    _checkClassDetail(state, undefined);
}

function checkClassDetail(code: string, name?: string) {
    const state = parseAndGetTestState(code).state;
    _checkClassDetail(state, state.getRangeByMarkerName('marker') ?? state.getRangeByMarkerName('range'), name);
}

function _checkClassDetail(state: TestState, range: Range | undefined, name?: string) {
    const node = getNodeAtMarker(state);
    assert(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert(type?.category === TypeCategory.Class);

    assert.strictEqual(name ?? node.d.value, type.priv.aliasName ?? type.shared.name);

    if (range) {
        assert(type.shared.declaration);
        assert(isClassDeclaration(type.shared.declaration));

        assert.deepStrictEqual(
            TextRange.create(type.shared.declaration.node.start, type.shared.declaration.node.length),
            TextRange.fromBounds(range.pos, range.end)
        );
    } else {
        // There should be no decl.
        assert(!type.shared.declaration);
    }
}
