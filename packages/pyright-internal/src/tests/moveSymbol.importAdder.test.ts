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
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!"|}from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// [|{|"r":"from test import MyType!n!!n!!n!from typing import List, Mapping!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('import with alias', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!"|}from typing import List as l, Mapping as m
//// 
//// class MyType:
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: l[int]) -> None:
////     c: m[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// [|{|"r":"from test import MyType!n!!n!!n!from typing import List as l, Mapping as m!n!!n!!n!def foo(a: str, b: l[int]) -> None:!n!    c: m[str, MyType] = { 'hello', MyType() }", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('with existing imports', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!"|}from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: List[int]) -> None:
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
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!class MyType2(MyType):!n!    pass!n!!n!"|}from typing import List, Mapping
//// 
//// class MyType:
////     pass
////
//// class MyType2(MyType):
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType2() }|]

// @filename: moved.py
//// [|{|"r":"from typing import List, Mapping!n!from test import MyType, MyType2!n!m = MyType()!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType2() }", "name": "dest"|}from typing import Mapping
//// from test import MyType
//// m = MyType()|]
        `;

    testFromCode(code);
});

test('merge with existing moving symbol imports', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!"|}from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: List[int]) -> None:
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
//// [|{|"r":"!n!class MyType:!n!    pass!n!!n!"|}from typing import List, Mapping
//// 
//// class MyType:
////     pass
//// 
//// def [|/*marker*/foo|](a: str, b: List[int]) -> None:
////     c: Mapping[str, MyType] = { 'hello', MyType() }|]

// @filename: moved.py
//// [|{|"r":"from typing import List, Mapping!n!!n!from test import MyType!n!!n!!n!def foo(a: str, b: List[int]) -> None:!n!    c: Mapping[str, MyType] = { 'hello', MyType() }!n!!n!foo()", "name": "dest"|}from typing import List, Mapping
//// from test import foo
//// 
//// foo()|]
        `;

    testFromCode(code);
});

test('symbol from destination file used', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!"|}from moved import MyType
//// 
//// def [|/*marker*/foo|](a: MyType) -> None:
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
//// [|{|"r":"!n!"|}from moved import MyType
//// 
//// def [|/*marker*/foo|](a: MyType) -> None:
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
//// [|{|"r":"!n!"|}from moved import MyType
//// 
//// def [|/*marker*/foo|](a: MyType) -> None:
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
//// [|{|"r":"!n!"|}from moved import MyType
//// 
//// def [|/*marker*/foo|](a: MyType) -> None:
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

test('symbol with import statements', () => {
    const code = `
// @filename: test.py
//// [|{|"r": "import sys!n!!n!"|}import os, os.path, sys
//// 
//// def [|/*marker*/foo|]():
////     p = os.path.curdir
////     os.abort()|]

// @filename: moved.py
//// [|{|"r": "import os!n!import os.path!n!!n!!n!def foo():!n!    p = os.path.curdir!n!    os.abort()", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol with import statements with alias', () => {
    const code = `
// @filename: test.py
//// [|{|"r": "import sys!n!!n!"|}import os, os.path as path, sys
//// 
//// def [|/*marker*/foo|]():
////     p = path.curdir
////     os.abort()|]

// @filename: moved.py
//// [|{|"r": "import os!n!import os.path as path!n!!n!!n!def foo():!n!    p = path.curdir!n!    os.abort()", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol with import statements with alias 2', () => {
    const code = `
// @filename: test.py
//// [|{|"r": "import sys!n!!n!"|}import os, os.path as p1, sys
//// 
//// def [|/*marker*/foo|]():
////     p = p1.curdir
////     os.abort()|]

// @filename: moved.py
//// [|{|"r": "import os!n!import os.path as p1!n!!n!!n!def foo():!n!    p = p1.curdir!n!    os.abort()", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol with import statements with multiple unused imports', () => {
    const code = `
// @filename: test.py
//// [|{|"r": "import os.path, sys!n!!n!"|}import os, os.path, sys
//// 
//// def [|/*marker*/foo|]():
////     os.abort()|]

// @filename: moved.py
//// [|{|"r": "import os!n!!n!!n!def foo():!n!    os.abort()", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol with import statements with used imports', () => {
    const code = `
// @filename: test.py
//// [|{|"r": "import os.path as path, sys!n!!n!p = path.curdir!n!!n!"|}import os, os.path as path, sys
//// 
//// p = path.curdir
////
//// def [|/*marker*/foo|]():
////     p = path.curdir
////     os.abort()|]

// @filename: moved.py
//// [|{|"r": "import os!n!import os.path as path!n!!n!!n!def foo():!n!    p = path.curdir!n!    os.abort()", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('symbol with invalid import', () => {
    const code = `
// @filename: test.py
//// import notExist
//// 
//// p = notExist.fooStr
////
//// [|{|"r": ""|}def [|/*marker*/foo|]():
////     p = notExist.fooStr|]

// @filename: moved.py
//// [|{|"r": "def foo():!n!    p = notExist.fooStr", "name": "dest"|}|]
        `;

    testFromCode(code, true);
});

test('symbol with import with error', () => {
    const code = `
// @filename: test.py
//// #pyright: strict
//// import lib # should have no stub diagnostic
//// 
//// lib.bar()
////
//// [|{|"r": ""|}def [|/*marker*/foo|]():
////     p = lib.bar()|]

// @filename: lib/__init__.py
// @library: true
//// def bar(): pass

// @filename: moved.py
//// [|{|"r": "import lib!n!!n!!n!def foo():!n!    p = lib.bar()", "name": "dest"|}|]
        `;

    testFromCode(code, true);
});

function testFromCode(code: string, expectsMissingImport = false) {
    const state = parseAndGetTestState(code).state;

    testMoveSymbolAtPosition(
        state,
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start,
        undefined,
        undefined,
        expectsMissingImport
    );
}
