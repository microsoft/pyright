/*
 * documentSymbolCollector.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests documentSymbolCollector
 */

import { parseAndGetTestState } from './harness/fourslash/testState';
import { verifyReferencesAtPosition } from './testStateUtils';

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
        .map((r) => ({ uri: r.fileUri, range: state.convertPositionRange(r) }));

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
        .map((r) => ({ uri: r.fileUri, range: state.convertPositionRange(r) }));

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
