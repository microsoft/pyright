/*
 * importAdder.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * tests for importMover.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { rangesAreEqual, TextRange } from '../common/textRange';
import { ImportAdder } from '../languageService/importAdder';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('builtin types', () => {
    const code = `
// @filename: test1.py
//// [|/*src*/a: str = "hello"
//// b: int = 1
//// c: True = True
//// d: None = None|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('intrinsic types', () => {
    const code = `
// @filename: test1.py
//// if __name__ == __path__:
////     pass
////
//// [|/*src*/if __name__ === "__main__":
////     pass
//// b = __path__|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('handle variable in range', () => {
    const code = `
// @filename: test1.py
//// [|/*src*/variableToMove = 1|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move variable', () => {
    const code = `
// @filename: test1.py
//// variableToMove = 1
//// [|/*src*/a = variableToMove|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import variableToMove!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move multiple variables', () => {
    const code = `
// @filename: test1.py
//// variableToMove1 = 1
//// variableToMove2 = 2
//// [|/*src*/a = variableToMove1
//// a = variableToMove2|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import variableToMove1, variableToMove2!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle local variables', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     variableToMove1 = 1
////     variableToMove2 = 2
////     [|/*src*/a = variableToMove1
////     a = variableToMove2|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('handle parameter variable', () => {
    const code = `
// @filename: test1.py
//// def foo(p: int):
////     [|/*src*/a = p|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move private variable', () => {
    const code = `
// @filename: test1.py
//// __private = 1
//// [|/*src*/a = __private|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import __private!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle function in range', () => {
    const code = `
// @filename: test1.py
//// [|/*src*/def foo():
////     pass|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move function', () => {
    const code = `
// @filename: test1.py
//// def foo(): pass
//// [|/*src*/foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move multiple functions', () => {
    const code = `
// @filename: test1.py
//// def foo(): pass
//// def bar(): pass
//// [|/*src*/foo()
//// bar()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import bar, foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle inner function', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     def bar(): pass
////     [|/*src*/bar()|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move private function', () => {
    const code = `
// @filename: test1.py
//// def __private(): pass
//// [|/*src*/__private()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import __private!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class in range', () => {
    const code = `
// @filename: test1.py
//// [|/*src*/class A: pass|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move class', () => {
    const code = `
// @filename: test1.py
//// class A: pass
//// [|/*src*/a = A()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import A!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move multiple classes', () => {
    const code = `
// @filename: test1.py
//// class A: pass
//// class B: pass
//// [|/*src*/a = A()
//// a = B()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import A, B!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle inner class through self', () => {
    const code = `
// @filename: test1.py
//// class A:
////     class B: pass
////     def foo(self):
////         [|/*src*/b = self.B()|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('handle inner class through type', () => {
    const code = `
// @filename: test1.py
//// class A:
////     class B: pass
////     def foo(self):
////         [|/*src*/b = A.B()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import A!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class variable', () => {
    const code = `
// @filename: test1.py
//// class A:
////     def __init__(self):
////         self.a = 1
//// c = A();
//// [|/*src*/a = c.a|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import c!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class static variable', () => {
    const code = `
// @filename: test1.py
//// class A:
////     V = 1
//// [|/*src*/a = A.V|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import A!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class function', () => {
    const code = `
// @filename: test1.py
//// class A:
////     def __init__(self): pass
////     def foo(self): pass
//// c = A();
//// [|/*src*/a = c.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import c!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class static function', () => {
    const code = `
// @filename: test1.py
//// class A:
////     def Foo(): pass
//// [|/*src*/a = A.Foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import A!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('handle class function parameter', () => {
    const code = `
// @filename: test1.py
//// class A:
////     def __init__(self):
////         [|/*src*/self.a = 1|]

// @filename: test2.py
//// [|/*dest*/|]
        `;

    testImportMove(code);
});

test('move private class', () => {
    const code = `
// @filename: test1.py
//// class __A:
////     class B: pass
//// [|/*src*/a = __A()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from test1 import __A!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move simple import statement', () => {
    const code = `
// @filename: test1.py
//// import typing
//// 
//// [|/*src*/a: typing.Any = 1|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import typing!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move import statement with alias', () => {
    const code = `
// @filename: test1.py
//// import typing as t
//// 
//// [|/*src*/a: t.Any = 1|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import typing as t!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move dotted import statement', () => {
    const code = `
// @filename: test1.py
//// import json.encoder
//// 
//// [|/*src*/a = json.encoder.JSONEncoder()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json.encoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move dotted statement with alias', () => {
    const code = `
// @filename: test1.py
//// import json.encoder as j
//// 
//// [|/*src*/a = j.JSONEncoder()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json.encoder as j!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move both dotted import and regular statement', () => {
    const code = `
// @filename: test1.py
//// import json
//// import json.encoder
//// 
//// a = json.encoder.JSONEncoder()
//// [|/*src*/b = json.loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move both dotted import and regular statement with alias', () => {
    const code = `
// @filename: test1.py
//// import json as j
//// import json.encoder
//// 
//// a = json.encoder.JSONEncoder()
//// [|/*src*/b = j.loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json as j!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple import statements', () => {
    const code = `
// @filename: test1.py
//// import json
//// import json.encoder
//// 
//// [|/*src*/a = json.encoder.JSONEncoder()
//// b = json.loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json!n!import json.encoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple import statements with alias', () => {
    const code = `
// @filename: test1.py
//// import json as j
//// import json.encoder as j2
//// 
//// [|/*src*/a = j2.JSONEncoder()
//// b = j.loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json as j!n!import json.encoder as j2!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple import statements - nested', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     import json
////     import json.encoder
////     
////     [|/*src*/a = json.encoder.JSONEncoder()
////     b = json.loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import json!n!import json.encoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple import statements - part of nested body', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     import json
////     import json.encoder
////     
////     [|/*src*/a = json.encoder.JSONEncoder()|]
////     b = json.loads("")

// @filename: test2.py
//// [|/*dest*/{|"r":"import json.encoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple import statements - multi dotted name', () => {
    const code = `
// @filename: nested/__init__.py
//// def foo(): pass

// @filename: nested/nested2/__init__.py
//// def foo(): pass

// @filename: nested/nested2/module.py
//// def foo(): pass

// @filename: test1.py
//// import nested
//// import nested.nested2
//// import nested.nested2.module
//// 
//// nested.foo()
//// 
//// [|/*src*/nested.nested2.foo()
//// nested.nested2.module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import nested.nested2!n!import nested.nested2.module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move simple from import statement', () => {
    const code = `
// @filename: test1.py
//// from typing import Any
//// 
//// [|/*src*/a: Any = 1|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from typing import Any!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move from import statement with alias', () => {
    const code = `
// @filename: test1.py
//// from typing import Any as t
//// 
//// [|/*src*/a: t = 1|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from typing import Any as t!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move submodule from import statement', () => {
    const code = `
// @filename: test1.py
//// from json import encoder
//// 
//// [|/*src*/a = encoder.JSONEncoder()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import encoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move submodule from import statement with alias', () => {
    const code = `
// @filename: test1.py
//// from json import encoder as e
//// 
//// [|/*src*/a = e.JSONEncoder()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import encoder as e!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move dotted from import statement', () => {
    const code = `
// @filename: test1.py
//// from json.encoder import JSONEncoder
//// 
//// [|/*src*/a = JSONEncoder()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json.encoder import JSONEncoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move dotted from import statement with alias', () => {
    const code = `
// @filename: test1.py
//// from json.encoder import JSONEncoder as j
//// 
//// [|/*src*/a = j()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json.encoder import JSONEncoder as j!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move both dotted from import and regular statement', () => {
    const code = `
// @filename: test1.py
//// from json import loads
//// from json.encoder import JSONEncoder
//// 
//// a = JSONEncoder()
//// [|/*src*/b = loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import loads!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move both dotted from import and regular statement with alias', () => {
    const code = `
// @filename: test1.py
//// from json import loads as j
//// from json.encoder import JSONEncoder
//// 
//// a = JSONEncoder()
//// [|/*src*/b = j("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import loads as j!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple from import statements', () => {
    const code = `
// @filename: test1.py
//// from json import loads
//// from json.encoder import JSONEncoder
//// 
//// [|/*src*/a = JSONEncoder()
//// b = loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import loads!n!from json.encoder import JSONEncoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple from import statements with alias', () => {
    const code = `
// @filename: test1.py
//// from json import loads as j
//// from json.encoder import JSONEncoder as j2
//// 
//// [|/*src*/a = j2()
//// b = j("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import loads as j!n!from json.encoder import JSONEncoder as j2!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple from import statements - nested', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     from json import loads
////     from json.encoder import JSONEncoder
////     
////     [|/*src*/a = JSONEncoder()
////     b = loads("")|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from json import loads!n!from json.encoder import JSONEncoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple from import statements - part of nested body', () => {
    const code = `
// @filename: test1.py
//// def foo():
////     from json import loads
////     from json.encoder import JSONEncoder
////     
////     [|/*src*/a = JSONEncoder()|]
////     b = loads("")

// @filename: test2.py
//// [|/*dest*/{|"r":"from json.encoder import JSONEncoder!n!!n!!n!"|}|]
////
        `;

    testImportMove(code);
});

test('move multiple from import statements - multi dotted name', () => {
    const code = `
// @filename: nested/__init__.py
//// def foo(): pass

// @filename: nested/nested2/__init__.py
//// def foo2(): pass

// @filename: nested/nested2/module.py
//// def foo3(): pass

// @filename: test1.py
//// from nested import foo
//// from nested.nested2 import foo2
//// from nested.nested2.module import foo3
//// 
//// foo()
//// 
//// [|/*src*/foo2()
//// foo3()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested.nested2 import foo2!n!from nested.nested2.module import foo3!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('relative path from import', () => {
    const code = `
// @filename: nested/__init__.py
//// def foo(): pass

// @filename: nested/nested2/__init__.py
//// def foo2(): pass

// @filename: nested/nested2/module.py
//// def foo3(): pass

// @filename: nested/nested2/test1.py
//// from ...nested import foo
//// from ..nested2 import foo2
//// from .module import foo3
//// [|/*src*/foo()
//// foo2()
//// foo3()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested import foo!n!from nested.nested2 import foo2!n!from nested.nested2.module import foo3!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('namespace package from import', () => {
    const code = `
// @filename: nested/module.py
//// def foo(): pass

// @filename: test1.py
//// from nested.module import foo
//// 
//// [|/*src*/foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested.module import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('namespace package with submodule from import', () => {
    const code = `
// @filename: nested/module.py
//// def foo(): pass

// @filename: test1.py
//// from nested import module
//// 
//// [|/*src*/module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested import module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('multi nested namespace package with submodule from import', () => {
    const code = `
// @filename: nested/nested2/nested3/module.py
//// def foo(): pass

// @filename: test1.py
//// from nested.nested2.nested3 import module
//// 
//// [|/*src*/module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested.nested2.nested3 import module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('multi nested namespace package with __init__ from import', () => {
    const code = `
// @filename: nested/nested2/nested3/__init__.py
//// def foo(): pass

// @filename: test1.py
//// from nested.nested2.nested3 import foo
//// 
//// [|/*src*/foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested.nested2.nested3 import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('namespace package with relative path to root - from import', () => {
    const code = `
// @filename: module.py
//// def foo(): pass

// @filename: test1.py
//// from . import module
//// 
//// [|/*src*/module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from . import module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('namespace package with relative path from import', () => {
    const code = `
// @filename: nested/module.py
//// def foo(): pass

// @filename: test1.py
//// from .nested import module
//// 
//// [|/*src*/module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from nested import module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('namespace package import', () => {
    const code = `
// @filename: nested/module.py
//// def foo(): pass

// @filename: test1.py
//// import nested.module
//// 
//// [|/*src*/nested.module.foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"import nested.module!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('__init__ at root', () => {
    const code = `
// @filename: __init__.py
//// def foo(): pass

// @filename: test1.py
//// from . import foo
//// 
//// [|/*src*/foo()|]

// @filename: test2.py
//// [|/*dest*/{|"r":"from . import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('__init__ at root to nested file', () => {
    const code = `
// @filename: __init__.py
//// def foo(): pass

// @filename: test1.py
//// from . import foo
//// 
//// [|/*src*/foo()|]

// @filename: nested/test2.py
//// [|/*dest*/{|"r":"from .. import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move wild card imports', () => {
    const code = `
// @filename: module.py
//// def foo(): pass
//// __all__ = [ 'foo' ]

// @filename: test1.py
//// from module import *
//// 
//// [|/*src*/foo()|]

// @filename: nested/test2.py
//// [|/*dest*/{|"r":"from module import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('move wild card imports from __init__', () => {
    const code = `
// @filename: nested/__init__.py
//// def foo(): pass
//// __all__ = [ 'foo' ]

// @filename: test1.py
//// from nested import *
//// 
//// [|/*src*/foo()|]

// @filename: nested/test2.py
//// [|/*dest*/{|"r":"from nested import foo!n!!n!!n!"|}|]
        `;

    testImportMove(code);
});

test('merge with existing import', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// [|/*src*/a = val2|]

// @filename: test2.py
//// from test1 import val1[|/*dest*/{|"r":", val2"|}|]
        `;

    testImportMove(code);
});

test('merge multiple symbols with existing import', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// val3 = 3
//// [|/*src*/a = val2
//// b = val3|]

// @filename: test2.py
//// from test1 import val1[|/*dest*/{|"r":", val2, val3"|}|]
        `;

    testImportMove(code);
});

test('move with existing import with wild card', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// [|/*src*/a = val2|]

// @filename: test2.py
//// from test1 import *[|/*dest*/{|"r":"!n!from test1 import val2"|}|]
        `;

    testImportMove(code);
});

test('merge multiple symbols with multiple existing import and wildcard', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// val3 = 3
//// [|/*src*/a = val2
//// b = val3|]

// @filename: test2.py
//// from test1 import *
//// from test1 import val1[|/*dest*/{|"r":", val2, val3"|}|]
        `;

    testImportMove(code);
});

test('merge multiple symbols with multiple existing import', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// val3 = 3
//// [|/*src*/a = val2
//// b = val3|]

// @filename: test2.py
//// from test1 import val1[|{|"r":", val3"|}|]
//// from test1 import val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('merge multiple symbols with multiple existing import with alias', () => {
    const code = `
// @filename: test1.py
//// val1 = 1
//// val2 = 2
//// val3 = 3
//// [|/*src*/a = val2
//// b = val3|]

// @filename: test2.py
//// from test1 import val1[|{|"r":", val2, val3"|}|]
//// from test1 import val2 as v[|/*dest*/|]
        `;

    testImportMove(code);
});

test('skip with existing import statement', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// import module
////
//// [|/*src*/a = module.val1|]

// @filename: test2.py
//// import module
//// module.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('skip with existing import statement with alias', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// import module as m
////
//// [|/*src*/a = m.val1|]

// @filename: test2.py
//// import module as m
//// m.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('merge with existing import statement with alias', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// import module
////
//// [|/*src*/a = module.val1|]

// @filename: test2.py
//// import module as m[|{|"r":"!n!import module"|}|]
//// m.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('merge with existing import statement with alias 2', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// import module as m
////
//// [|/*src*/a = m.val1|]

// @filename: test2.py
//// import module[|{|"r":"!n!import module as m"|}|]
//// module.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('mixed with submodule and import - duplicated import', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// import module
////
//// [|/*src*/a = module.val1|]

// @filename: test2.py
//// [|{|"r":"import module!n!"|}|]from . import module
//// module.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('mixed with submodule and import - duplicated import 2', () => {
    const code = `
// @filename: module.py
//// val1 = 1
//// val2 = 3

// @filename: test1.py
//// from . import module
////
//// [|/*src*/a = module.val1|]

// @filename: test2.py
//// [|{|"r":"from . import module!n!"|}|]import module
//// module.val2[|/*dest*/|]
        `;

    testImportMove(code);
});

test('multiple mixed import statements', () => {
    const code = `
// @filename: test1.py
//// import typing
//// from os import path
//// import json.encoder as j
//// import json.decoder
////
//// [|/*src*/def foo(p1: str, p2: typing.Any, p3: typing.Union[int, str]):
////     b = path.join(p1)
////     e = j.JSONEncoder(skipkeys=True)
////     d = json.decoder.JSONDecoder()|]
// @filename: test2.py
//// [|{|"r":"import json.decoder!n!import json.encoder as j!n!"|}|]import os[|{|"r":"!n!from os import path"|}|]
//// import sys
//// import typing
//// from json import decoder[|/*dest*/|]
        `;
    testImportMove(code);
});

test('multiple mixed import statements with merge', () => {
    const code = `
// @filename: test1.py
//// import typing
//// from os import path
//// from json import encoder as j
//// from json import decoder
////
//// [|/*src*/def foo(p1: str, p2: typing.Any, p3: typing.Union[int, str]):
////     b = path.join(p1)
////     e = j.JSONEncoder(skipkeys=True)
////     d = decoder.JSONDecoder()|]
// @filename: test2.py
//// import sys
//// import typing
//// from os import abort[|{|"r":", path"|}|]
//// from json import decoder[|{|"r":", encoder as j"|}|][|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file import statement', () => {
    const code = `
// @filename: test1.py
//// import test2
////
//// [|/*src*/test2.foo()|]

// @filename: test2.py
//// [|{|"r":"import test2!n!!n!!n!"|}|]def foo(): pass
//// [|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file from import statement', () => {
    const code = `
// @filename: test1.py
//// from test2 import foo
////
//// [|/*src*/foo()|]

// @filename: test2.py
//// def foo(): pass
//// [|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file from import statement with alias', () => {
    const code = `
// @filename: test1.py
//// from test2 import foo as f
////
//// [|/*src*/f()|]

// @filename: test2.py
//// [|{|"r":"from test2 import foo as f!n!!n!!n!"|}|]def foo(): pass
//// [|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file from import statement for __init__', () => {
    const code = `
// @filename: test1.py
//// from nested import foo
////
//// [|/*src*/foo()|]

// @filename: nested/__init__.py
//// def foo(): pass
//// [|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file from import statement for __init__ with alias', () => {
    const code = `
// @filename: test1.py
//// from nested import foo as f
////
//// [|/*src*/f()|]

// @filename: nested/__init__.py
//// [|{|"r":"from nested import foo as f!n!!n!!n!"|}|]def foo(): pass
//// [|/*dest*/|]
        `;
    testImportMove(code);
});

test('move into the same file from import statement for submodule', () => {
    const code = `
// @filename: test1.py
//// from nested import module
////
//// [|/*src*/module.foo()|]

// @filename: nested/__init__.py
//// [|{|"r":"from nested import module!n!!n!!n!"|}|][|/*dest*/|]

// @filename: nested/module.py
//// def foo(): pass
        `;
    testImportMove(code);
});

function testImportMove(code: string) {
    const state = parseAndGetTestState(code).state;

    const src = state.getRangeByMarkerName('src')!;
    const dest = state.getMarkerByName('dest');

    const importMover = new ImportAdder(state.configOptions, state.importResolver, state.program.evaluator!);
    const importData = importMover.collectImportsForSymbolsUsed(
        state.program.getBoundSourceFile(src.fileName)!.getParseResults()!,
        TextRange.fromBounds(src.pos, src.end),
        CancellationToken.None
    );

    const edits = importMover.applyImports(
        importData,
        state.program.getBoundSourceFile(dest.fileName)!.getParseResults()!,
        dest.position,
        CancellationToken.None
    );

    assert(edits);

    const ranges = state.getRanges().filter((r) => !!r.marker?.data);
    assert.strictEqual(edits.length, ranges.length);

    for (const edit of edits) {
        assert(
            ranges.some((r) => {
                const data = r.marker!.data as { r: string };
                const expectedText = data.r;
                const expectedRange = state.convertPositionRange(r);
                return (
                    rangesAreEqual(expectedRange, edit.range) &&
                    expectedText.replace(/!n!/g, '\n') === edit.replacementText
                );
            }),
            `can't find '${edit.replacementText}'@'(${edit.range.start.line},${edit.range.start.character})'`
        );
    }
}
