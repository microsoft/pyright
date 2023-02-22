/*
 * moveSymbol.importAdder.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * importAdder tests around move symbol.
 */

import { parseAndGetTestState } from './harness/fourslash/testState';
import { testMoveSymbolAtPosition } from './renameModuleTestUtils';

test('move imports used in the symbol', () => {
    const code = `
// @filename: test.py
//// from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// [|{|"r":"from typing import List, Mapping!n!!n!!n!"|}|][|{|"r":"from test import MyType!n!!n!!n!"|}|][|{|"r":"def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('import with alias', () => {
    const code = `
// @filename: test.py
//// from typing import List as l, Mapping as m
//// 
//// class MyType:
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: l[int]) -> None:
////     c: m[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// [|{|"r":"from typing import List as l, Mapping as m!n!!n!!n!"|}|][|{|"r":"from test import MyType!n!!n!!n!"|}|][|{|"r":"def foo(a: str, b: l[int]) -> None:!n!    c: m[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('with existing imports', () => {
    const code = `
// @filename: test.py
//// from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// from typing import List, Mapping
//// from test import MyType[|{|"r":"!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('merge with existing imports', () => {
    const code = `
// @filename: test.py
//// from typing import List, Mapping
//// 
//// class MyType:
////     pass
////
//// class MyType2(MyType):
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType2() }|]

// @filename: moved.py
//// from typing import Mapping[|{|"r":"!n!from typing import List"|}|]
//// from test import MyType[|{|"r":"!n!from test import MyType2"|}|]
//// m = MyType()[|{|"r":"!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType2() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('merge with existing moving symbol imports', () => {
    const code = `
// @filename: test.py
//// from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// from typing import List, Mapping
//// from test import [|{|"r":""|}foo, |]MyType[|{|"r":"!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
//// 
//// foo()
        `;

    testFromCode(code);
});

test('merge with existing moving symbol imports and add new one', () => {
    const code = `
// @filename: test.py
//// from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// from typing import List, Mapping
//// [|{|"r":""|}from test import foo[|{|"r":"!n!from test import MyType"|}|][|{|"r":"!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
//// |]
//// foo()
        `;

    testFromCode(code);
});

test('symbol from destination file used', () => {
    const code = `
// @filename: test.py
//// from moved import MyType
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: MyType) -> None:
////     c: Mapping[str, MyType] = { 'hello', a }|]

// @filename: moved.py
//// class MyType:
////     pass[|{|"r":"!n!!n!!n!def foo(a: MyType) -> None:!n!    c: Mapping[str, MyType] = { 'hello', a }", "name": "dest"|}|]
////
        `;

    testFromCode(code);
});

test('insert after all symbols references', () => {
    const code = `
// @filename: test.py
//// from moved import MyType
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: MyType) -> None:
////     c: Mapping[str, MyType] = { 'hello', a }|]

// @filename: moved.py
//// [|{|"r":""|}from test import foo
//// |]
//// class MyType:
////     pass[|{|"r":"!n!!n!!n!def foo(a: MyType) -> None:!n!    c: Mapping[str, MyType] = { 'hello', a }", "name": "dest"|}|]
////
//// foo()
        `;

    testFromCode(code);
});

test('insert after all symbols references 2', () => {
    const code = `
// @filename: test.py
//// from moved import MyType
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: MyType) -> None:
////     c: Mapping[str, MyType] = { 'hello', a }|]

// @filename: moved.py
//// def __privateFoo():
////     pass
////
//// class MyType:
////     pass[|{|"r":"!n!!n!!n!def foo(a: MyType) -> None:!n!    c: Mapping[str, MyType] = { 'hello', a }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol used before all symbol references', () => {
    const code = `
// @filename: test.py
//// from moved import MyType
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](a: MyType) -> None:
////     c: Mapping[str, MyType] = { 'hello', a }|]

// @filename: moved.py
//// [|{|"r":""|}from test import foo[|{|"r":"!n!!n!!n!def foo(a: MyType) -> None:!n!    c: Mapping[str, MyType] = { 'hello', a }", "name": "dest"|}|]
//// |]
//// foo()
////
//// class MyType:
////     pass
        `;

    testFromCode(code);
});

function testFromCode(code: string) {
    const state = parseAndGetTestState(code).state;

    testMoveSymbolAtPosition(
        state,
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start
    );
}
