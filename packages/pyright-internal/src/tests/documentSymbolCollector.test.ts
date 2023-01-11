/*
 * documentSymbolCollector.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests documentSymbolCollector
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { Program } from '../analyzer/program';
import { createMapFromItems } from '../common/collectionUtils';
import { ConfigOptions } from '../common/configOptions';
import { isArray } from '../common/core';
import { TextRange } from '../common/textRange';
import { DocumentSymbolCollector, DocumentSymbolCollectorUseCase } from '../languageService/documentSymbolCollector';
import { NameNode } from '../parser/parseNodes';
import { Range } from './harness/fourslash/fourSlashTypes';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('folder reference', () => {
    const code = `
// @filename: common/__init__.py
//// from [|io2|] import tools as tools
//// from [|io2|].tools import pathUtils as pathUtils

// @filename: io2/empty.py
//// # empty

// @filename: io2/tools/__init__.py
//// def combine(a, b):
////     pass

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from common import *
////
//// tools.combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test2.py
//// from .[|io2|] import tools as t
////
//// t.combine(1, 1)

// @filename: test3.py
//// from .[|io2|].tools import pathUtils as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import tools, pathUtils
////
//// tools.combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test5.py
//// from [|io2|] import tools as tools
//// from [|io2|].tools  import pathUtils as pathUtils
////
//// tools.combine(1, 1)
//// pathUtils.getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('io2')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'io2', range.fileName, range.pos, ranges);
    }
});

test('__init__ wildcard import', () => {
    const code = `
// @filename: common/__init__.py
//// from io2 import [|tools|] as [|tools|]
//// from io2.[|tools|] import pathUtils as pathUtils

// @filename: io2/empty.py
//// # empty

// @filename: io2/tools/__init__.py
//// def combine(a, b):
////     pass

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from common import *
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test2.py
//// from .io2 import [|tools|] as t
////
//// t.combine(1, 1)

// @filename: test3.py
//// from .io2.[|tools|] import pathUtils as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import [|tools|], pathUtils
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test5.py
//// from io2 import [|tools|] as [|tools|]
//// from io2.[|tools|]  import pathUtils as pathUtils
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('tools')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'tools', range.fileName, range.pos, ranges);
    }
});

test('submodule wildcard import', () => {
    const code = `
// @filename: common/__init__.py
//// from io2 import tools as tools
//// from io2.tools import [|pathUtils|] as [|pathUtils|]

// @filename: io2/empty.py
//// # empty

// @filename: io2/tools/__init__.py
//// def combine(a, b):
////     pass

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from common import *
////
//// tools.combine(1, 1)
//// [|pathUtils|].getFilename("c")

// @filename: test2.py
//// from .io2 import tools as t
////
//// t.combine(1, 1)

// @filename: test3.py
//// from .io2.tools import [|pathUtils|] as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import tools, [|pathUtils|]
////
//// tools.combine(1, 1)
//// [|pathUtils|].getFilename("c")

// @filename: test5.py
//// from io2 import tools as tools
//// from io2.tools  import [|pathUtils|] as [|pathUtils|]
////
//// tools.combine(1, 1)
//// [|pathUtils|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('pathUtils')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'pathUtils', range.fileName, range.pos, ranges);
    }
});

test('use localName import alias', () => {
    const code = `
// @filename: common/__init__.py
//// from io2 import tools as [|/*marker1*/tools|]
//// from io2.tools import pathUtils as pathUtils

// @filename: io2/empty.py
//// # empty

// @filename: io2/tools/__init__.py
//// def combine(a, b):
////     pass

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from common import *
////
//// [|/*marker2*/tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test2.py
//// from .io2 import tools as t
////
//// t.combine(1, 1)

// @filename: test3.py
//// from .io2.tools import pathUtils as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import [|/*marker3*/tools|], pathUtils
////
//// [|/*marker4*/tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test5.py
//// from io2 import tools as [|/*marker5*/tools|]
//// from io2.tools  import pathUtils as pathUtils
////
//// [|/*marker6*/tools|].combine(1, 1)
//// pathUtils.getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const references = state
        .getRangesByText()
        .get('tools')!
        .map((r) => ({ path: r.fileName, range: state.convertPositionRange(r) }));

    state.verifyFindAllReferences({
        marker1: { references },
        marker2: { references },
        marker3: { references },
        marker4: { references },
        marker5: { references },
        marker6: { references },
    });
});

test('use localName import module', () => {
    const code = `
// @filename: common/__init__.py
//// from io2 import [|/*marker1*/tools|] as [|tools|]
//// from io2.[|/*marker2*/tools|] import pathUtils as pathUtils

// @filename: io2/empty.py
//// # empty

// @filename: io2/tools/__init__.py
//// def combine(a, b):
////     pass

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from common import *
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test2.py
//// from .io2 import [|/*marker3*/tools|] as t
////
//// t.combine(1, 1)

// @filename: test3.py
//// from .io2.[|/*marker4*/tools|] import pathUtils as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import [|tools|], pathUtils
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")

// @filename: test5.py
//// from io2 import [|/*marker5*/tools|] as [|tools|]
//// from io2.[|/*marker6*/tools|]  import pathUtils as pathUtils
////
//// [|tools|].combine(1, 1)
//// pathUtils.getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const references = state
        .getRangesByText()
        .get('tools')!
        .map((r) => ({ path: r.fileName, range: state.convertPositionRange(r) }));

    state.verifyFindAllReferences({
        marker1: { references },
        marker2: { references },
        marker3: { references },
        marker4: { references },
        marker5: { references },
        marker6: { references },
    });
});

test('import dotted name', () => {
    const code = `
// @filename: nest1/__init__.py
//// # empty

// @filename: nest1/nest2/__init__.py
//// # empty

// @filename: nest1/nest2/module.py
//// def foo():
////     pass

// @filename: test1.py
//// import [|nest1|].[|nest2|].[|module|]
////
//// [|nest1|].[|nest2|].[|module|]

// @filename: nest1/test2.py
//// import [|nest1|].[|nest2|].[|module|]
////
//// [|nest1|].[|nest2|].[|module|]
    `;

    const state = parseAndGetTestState(code).state;

    function verify(name: string) {
        const ranges = state.getRangesByText().get(name)!;
        for (const range of ranges) {
            verifyReferencesAtPosition(state.program, state.configOptions, name, range.fileName, range.pos, ranges);
        }
    }

    verify('nest1');
    verify('nest2');
    verify('module');
});

test('import alias', () => {
    const code = `
// @filename: nest/__init__.py
//// # empty

// @filename: nest/module2.py
//// # empty

// @filename: module1.py
//// # empty

// @filename: test1.py
//// import [|/*marker1*/module1|] as [|module1|]

// @filename: test2.py
//// import nest.[|/*marker2*/module2|] as [|module2|]
    `;

    const state = parseAndGetTestState(code).state;

    const marker1 = state.getMarkerByName('marker1');
    const ranges1 = state.getRangesByText().get('module1')!;
    verifyReferencesAtPosition(
        state.program,
        state.configOptions,
        'module1',
        marker1.fileName,
        marker1.position,
        ranges1
    );

    const marker2 = state.getMarkerByName('marker2');
    const ranges2 = state.getRangesByText().get('module2')!;
    verifyReferencesAtPosition(
        state.program,
        state.configOptions,
        'module2',
        marker2.fileName,
        marker2.position,
        ranges2
    );
});

test('string in __all__', () => {
    const code = `
// @filename: test1.py
//// class [|/*marker1*/A|]:
////     pass
////
//// a: "[|A|]" = "A"
////
//// __all__ = [ "[|A|]" ]
    `;

    const state = parseAndGetTestState(code).state;

    const marker1 = state.getMarkerByName('marker1');
    const ranges1 = state.getRangesByText().get('A')!;
    verifyReferencesAtPosition(state.program, state.configOptions, 'A', marker1.fileName, marker1.position, ranges1);
});

test('overridden symbols test', () => {
    const code = `
// @filename: test.py
//// class B:
////     def [|foo|](self):
////         pass
////
//// class C(B):
////     def [|foo|](self):
////         pass
////
//// B().[|foo|]()
//// C().[|foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('overridden symbols multi inheritance test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|foo|](self):
////         pass
////
//// class B:
////     def [|foo|](self):
////         pass
////
//// class C(A, B):
////     def [|/*marker*/foo|](self):
////         pass
////
//// A().[|foo|]()
//// B().[|foo|]()
//// C().[|foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('foo')!;

    verifyReferencesAtPosition(state.program, state.configOptions, 'foo', marker.fileName, marker.position, ranges);
});

test('__init__ test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def __init__(self):
////         pass
////
//// class B:
////     def __init__(self):
////         pass
////
//// class C(A, B):
////     def [|/*marker*/__init__|](self):
////         pass
////
//// A()
//// B()
//// [|C|]()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('__init__')!;
    ranges.push(...state.getRangesByText().get('C')!);

    verifyReferencesAtPosition(
        state.program,
        state.configOptions,
        ['__init__', 'C'],
        marker.fileName,
        marker.position,
        ranges
    );
});

test('super __init__ test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|__init__|](self):
////         pass
////
//// class B:
////     def __init__(self):
////         pass
////
//// class C(A, B):
////     def __init__(self):
////         super().[|/*marker*/__init__|]()
////         pass
////
//// [|A|]()
//// B()
//// C()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('__init__')!;
    ranges.push(...state.getRangesByText().get('A')!);

    verifyReferencesAtPosition(
        state.program,
        state.configOptions,
        ['__init__', 'A'],
        marker.fileName,
        marker.position,
        ranges
    );
});

test('__init__ internal class test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def __init__(self):
////         class A_inner:
////            def [|/*marker*/__init__|](self):
////                pass
////         self.inner = [|A_inner|]()
////         
////
//// class B:
////     def __init__(self):
////         pass
////
//// class C(A, B):
////     def __init__(self):
////         pass
////
//// A()
//// B()
//// C()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('__init__')!;
    ranges.push(...state.getRangesByText().get('A_inner')!);

    verifyReferencesAtPosition(
        state.program,
        state.configOptions,
        ['__init__', 'A_inner'],
        marker.fileName,
        marker.position,
        ranges
    );
});

test('overridden symbols multi inheritance with multiple base with same name test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|/*marker*/foo|](self):
////         pass
////
//// class B:
////     def foo(self):
////         pass
////
//// class C(A, B):
////     def [|foo|](self):
////         pass
////
//// A().[|foo|]()
//// B().foo()
//// C().[|foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('foo')!;

    verifyReferencesAtPosition(state.program, state.configOptions, 'foo', marker.fileName, marker.position, ranges);
});

test('protocol member symbol test', () => {
    const code = `
// @filename: test.py
//// from typing import Protocol
////
//// class A:
////     def foo(self):
////         pass
////
//// class P(Protocol):
////     def [|foo|](self): ...
//// 
//// def foo(p: P):
////     p.[|/*marker*/foo|]()
//// 
//// foo(A().foo())
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('foo')!;

    verifyReferencesAtPosition(state.program, state.configOptions, 'foo', marker.fileName, marker.position, ranges);
});

test('overridden symbols nested inheritance test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|foo|](self):
////         pass
////
//// class B(A):
////     def [|foo|](self):
////         pass
////
//// class C(B):
////     def [|foo|](self):
////         pass
////
//// A().[|foo|]()
//// B().[|foo|]()
//// C().[|foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('overridden symbols nested inheritance no direct override test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|foo|](self):
////         pass
////
//// class B(A):
////     def [|foo|](self):
////         pass
////
//// class C(B):
////     pass
////
//// A().[|foo|]()
//// B().[|foo|]()
//// C().[|foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('overridden symbols different type test', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|foo|](self):
////         pass
////
//// class B:
////     foo: int
////
//// class C(A, B):
////     def [|foo|](self):
////         pass
////
//// A().[|foo|]()
//// B().foo = 1
//// C().[|/*marker*/foo|]()
    `;

    const state = parseAndGetTestState(code).state;

    const marker = state.getMarkerByName('marker');
    const ranges = state.getRangesByText().get('foo')!;

    verifyReferencesAtPosition(state.program, state.configOptions, 'foo', marker.fileName, marker.position, ranges);
});

test('overridden and overloaded symbol test', () => {
    const code = `
// @filename: test.py
//// from typing import overload
////
//// class A:
////     def [|foo|](self):
////         pass
////
//// class B(A):
////     @overload
////     def [|foo|](self):
////         pass
////     @overload
////     def [|foo|](self, a):
////         pass
////
//// A().[|foo|]()
//// B().[|foo|](1)
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('library method override test', () => {
    const code = `
// @filename: test.py
//// from lib import BaseType
////
//// class A(BaseType):
////     def [|foo|](self):
////         pass
////
//// A().[|foo|]()

// @filename: lib/__init__.py
// @library: true
//// class BaseType:
////     def foo(self):
////         pass
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('variable overridden test 1', () => {
    const code = `
// @filename: test.py
//// class A:
////     [|foo|] = 1
////
//// class B(A):
////     foo = 2
//// 
//// a = A().[|foo|]
//// b = B().foo
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

test('variable overridden test 2', () => {
    const code = `
// @filename: test.py
//// class A:
////     foo = 1
////
//// class B(A):
////     [|foo|] = 2
//// 
//// a = A().foo
//// b = B().[|foo|]
    `;

    const state = parseAndGetTestState(code).state;

    const ranges = state.getRangesByText().get('foo')!;
    for (const range of ranges) {
        verifyReferencesAtPosition(state.program, state.configOptions, 'foo', range.fileName, range.pos, ranges);
    }
});

function verifyReferencesAtPosition(
    program: Program,
    configOption: ConfigOptions,
    symbolNames: string | string[],
    fileName: string,
    position: number,
    ranges: Range[]
) {
    const sourceFile = program.getBoundSourceFile(fileName);
    assert(sourceFile);

    const node = findNodeByOffset(sourceFile.getParseResults()!.parseTree, position);
    const decls = DocumentSymbolCollector.getDeclarationsForNode(
        node as NameNode,
        program.evaluator!,
        /* resolveLocalName */ true,
        DocumentSymbolCollectorUseCase.Reference,
        CancellationToken.None,
        program.test_createSourceMapper(configOption.findExecEnvironment(fileName))
    );

    const rangesByFile = createMapFromItems(ranges, (r) => r.fileName);
    for (const rangeFileName of rangesByFile.keys()) {
        const collector = new DocumentSymbolCollector(
            isArray(symbolNames) ? symbolNames : [symbolNames],
            decls,
            program.evaluator!,
            CancellationToken.None,
            program.getBoundSourceFile(rangeFileName)!.getParseResults()!.parseTree,
            /* treatModuleInImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false,
            DocumentSymbolCollectorUseCase.Reference
        );

        const results = collector.collect();
        const rangesOnFile = rangesByFile.get(rangeFileName)!;
        assert.strictEqual(results.length, rangesOnFile.length, `${rangeFileName}@${symbolNames}`);

        for (const result of results) {
            assert(rangesOnFile.some((r) => r.pos === result.range.start && r.end === TextRange.getEnd(result.range)));
        }
    }
}
