/*
 * classDeclaration.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test class detail's declaration
 */

import assert from 'assert';

import { isClassDeclaration, isSpecialBuiltInClassDeclaration } from '../analyzer/declaration';
import { TypeCategory } from '../analyzer/types';
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

function checkSpecialBuiltInClassDetail(code: string) {
    const state = parseAndGetTestState(code).state;

    const node = getNodeAtMarker(state);
    assert(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert(type?.category === TypeCategory.Class);

    assert.strictEqual(node.value, type.aliasName ?? type.details.name);

    assert(type.details.declaration);
    if (type.aliasName) {
        assert(isClassDeclaration(type.details.declaration));
    } else {
        assert(isSpecialBuiltInClassDeclaration(type.details.declaration));
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

    assert.strictEqual(name ?? node.value, type.aliasName ?? type.details.name);

    if (range) {
        assert(type.details.declaration);
        assert(isClassDeclaration(type.details.declaration));

        assert.deepStrictEqual(
            TextRange.create(type.details.declaration.node.start, type.details.declaration.node.length),
            TextRange.fromBounds(range.pos, range.end)
        );
    } else {
        // There should be no decl.
        assert(!type.details.declaration);
    }
}
