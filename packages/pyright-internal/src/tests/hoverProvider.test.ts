/*
 * hoverProvider.test.ts
 *
 * hoverProvider tests.
 */

import { parseAndGetTestState } from './harness/fourslash/testState';

test('import tooltip - import statement', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import [|/*marker1*/matplotlib|].[|/*marker2*/pyplot|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(module) matplotlib\n```\n---\nmatplotlib',
        marker2: '```python\n(module) pyplot\n```\n---\npyplot',
    });
});

test('import tooltip - import reference', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib.pyplot
//// [|/*marker1*/matplotlib|].[|/*marker2*/pyplot|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(module) matplotlib\n```\n---\nmatplotlib',
        marker2: '```python\n(module) pyplot\n```\n---\npyplot',
    });
});

test('import tooltip - import statement with stubs', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import [|/*marker1*/matplotlib|].[|/*marker2*/pyplot|]

// @filename: matplotlib/__init__.pyi
// @library: true
//// # empty

// @filename: matplotlib/pyplot.pyi
// @library: true
//// # empty

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(module) matplotlib\n```\n---\nmatplotlib',
        marker2: '```python\n(module) pyplot\n```\n---\npyplot',
    });
});

test('import tooltip - import reference - stub files', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib.pyplot
//// [|/*marker1*/matplotlib|].[|/*marker2*/pyplot|]

// @filename: matplotlib/__init__.pyi
// @library: true
//// # empty

// @filename: matplotlib/pyplot.pyi
// @library: true
//// # empty

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(module) matplotlib\n```\n---\nmatplotlib',
        marker2: '```python\n(module) pyplot\n```\n---\npyplot',
    });
});

test('import tooltip - import submodules statement', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import A.B.[|/*marker*/C|]

// @filename: A/__init__.py
// @library: true
//// # empty

// @filename: A/B/__init__.py
// @library: true
//// # empty

// @filename: A/B/C/__init__.py
// @library: true
//// """ C """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', { marker: '```python\n(module) C\n```\n---\nC' });
});

test('import tooltip - import submodules reference', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import A.B.C
//// A.B.[|/*marker*/C|]

// @filename: A/__init__.py
// @library: true
//// # empty

// @filename: A/B/__init__.py
// @library: true
//// # empty

// @filename: A/B/C/__init__.py
// @library: true
//// """ C """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', { marker: '```python\n(module) C\n```\n---\nC' });
});

test('import tooltip - from import statement with stubs', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from [|/*marker1*/matplotlib|].[|/*marker2*/pyplot|] import *

// @filename: matplotlib/__init__.pyi
// @library: true
//// # empty

// @filename: matplotlib/pyplot.pyi
// @library: true
//// # empty

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(module) matplotlib\n```\n---\nmatplotlib',
        marker2: '```python\n(module) pyplot\n```\n---\npyplot',
    });
});

test('import tooltip - from import submodules statement', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from A.B.[|/*marker*/C|] import *

// @filename: A/__init__.py
// @library: true
//// # empty

// @filename: A/B/__init__.py
// @library: true
//// # empty

// @filename: A/B/C/__init__.py
// @library: true
//// """ C """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', { marker: '```python\n(module) C\n```\n---\nC' });
});

test('import tooltip - check duplicate property', async () => {
    const code = `

// @filename: test.py
//// class Test:
////     def __init__(self) -> None:
////         self.__test = False
//// 
////     @property
////     def [|/*marker*/test|](self):
////         """Test DocString.
//// 
////         Returns
////         -------
////         bool
////             Lorem Ipsum
////         """
////         return self.__test

    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(property) test: (self: Self@Test) -> bool\n```\n---\nTest DocString.\n\nReturns\n-------\nbool  \n&nbsp;&nbsp;&nbsp;&nbsp;Lorem Ipsum',
    });
});

test('import symbol tooltip - useLibraryCodeForTypes false', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": false
//// }

// @filename: test.py
//// from foo import [|/*marker1*/bar|]
//// from bar.baz1 import [|/*marker2*/baz2|]

// @filename: foo/__init__.py
// @library: true
//// from .bar import bar

// @filename: foo/bar.py
// @library: true
//// class bar: ...

// @filename: bar/baz1/baz2/__init__.py
// @library: true
//// class baz: ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(import) bar: Unknown\n```',
        marker2: '```python\n(module) baz2\n```',
    });
});

test('import symbol tooltip - useLibraryCodeForTypes true', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from foo import [|/*marker1*/bar|]

// @filename: foo/__init__.py
// @library: true
//// from .bar import bar

// @filename: foo/bar.py
// @library: true
//// class bar: ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(class) bar\n```',
    });
});

test('TypedDict doc string', async () => {
    const code = `
// @filename: test.py
//// from typing import [|/*marker*/TypedDict|]

// @filename: typing.py
// @library: true
//// def TypedDict(typename, fields=None, /, *, total=True, **kwargs):
////     """A simple typed namespace. At runtime it is equivalent to a plain dict."""
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker');
    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(class) TypedDict\n```\n---\nA simple typed namespace. At runtime it is equivalent to a plain dict.',
    });
});

test('hover on class Foo and its __call__ method with overloads', async () => {
    const code = `
// @filename: test.py
//// from typing import overload
//// class Foo:
////     def __init__(self):
////         pass
////
////     @overload
////     def __call__(self, a: int) -> int: pass
////     @overload
////     def __call__(self, a: str) -> str: pass
////     def __call__(self, a: int | str) ->  int | str:
////         return a   
////
//// [|/*marker1*/foo|] = Foo()
//// [|/*marker2*/foo|](1)
//// [|/*marker3*/foo|]("hello")
//// [|/*marker4*/foo|]()
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');

    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(variable) foo: Foo\n```',
        marker2: '```python\n(variable) def foo(a: int) -> int\n```',
        marker3: '```python\n(variable) def foo(a: str) -> str\n```',
        marker4: '```python\n(variable)\ndef __call__(a: int) -> int: ...\ndef __call__(a: str) -> str: ...\n```',
    });
});

test('hover on __call__ method', async () => {
    const code = `
// @filename: test.py
//// class Foo:
////     def __init__(self):
////         pass
////
////     def __call__(self, a: int) -> int:
////         return a   
////
//// [|/*marker1*/foo|] = Foo()
//// [|/*marker2*/foo|](1)
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');

    state.openFile(marker1.fileName);

    state.verifyHover('markdown', {
        marker1: '```python\n(variable) foo: Foo\n```',
        marker2: '```python\n(variable) def foo(a: int) -> int\n```',
    });
});
