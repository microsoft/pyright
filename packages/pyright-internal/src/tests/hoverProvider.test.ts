/*
 * hoverProvider.test.ts
 *
 * hoverProvider tests.
 */

import assert from 'assert';
import { CancellationToken, MarkupContent } from 'vscode-languageserver';

import { HoverProvider } from '../languageService/hoverProvider';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';

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

test('method tooltip - docstring from implementation when stub uses non-exported name', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from mylib import foo
//// foo.[|/*marker*/func|]()

// @filename: mylib/__init__.py
// @library: true
//// from ._private import Foo as _Foo
//// foo = _Foo()

// @filename: mylib/_private.py
// @library: true
//// class Foo:
////     """Some class documentation."""
////
////     def func(self) -> int:
////         """Some function documentation."""
////         return 1

// @filename: mylib/__init__.pyi
// @library: true
//// class Foo:
////     def func(self) -> int: ...
////
//// foo: Foo
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(method) def func() -> int\n```\n---\nSome function documentation.',
    });
});

test('function hover shows source default values for stub ellipsis defaults', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|](1)

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = 3) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int, b: str = 3) -> None\n```',
    });
});

test('function hover substitutes multiple stub ellipsis defaults from source', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|]()

// @filename: mylib.pyi
//// def f(a: int = ..., b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int = 3, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int = 3, b: str = "hello") -> None\n```',
    });
});

test('function hover shows concrete default values when provided by stub', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|]()

// @filename: mylib.pyi
//// def f(a: int = 3, b: str = "hello") -> None: ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int = 3, b: str = "hello") -> None\n```',
    });
});

test('function hover substitutes multiple stub ellipsis defaults for selected overload', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|](1)

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int = ..., b: str = ...) -> None: ...
////
//// @overload
//// def f(a: str = ..., b: str = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int = 3, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int = 3, b: str = "hello") -> None\n```',
    });
});

test('function hover does not substitute unsafe long defaults for stub ellipsis defaults', async () => {
    const longNumber = '9'.repeat(150);
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|](1)

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = ${longNumber}) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int, b: str = ...) -> None\n```',
    });
});

test('function hover does not substitute unsafe multiline defaults for stub ellipsis defaults', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker*/f|](1)

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = """hello
//// world""") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        marker: '```python\n(function) def f(a: int, b: str = ...) -> None\n```',
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

test('hover return type remains stable after trivial edit for callable-returning function', () => {
    const code = `
// @filename: test.py
//// from collections.abc import Callable
////
//// def [|/*markerA*/a|][**P, R](f: Callable[P, R]):
////     def [|/*markerB*/b|](*args: P.args, **kwargs: P.kwargs):
////         return str(f(*args, **kwargs))
////     return b
////
//// a
`;

    const state = parseAndGetTestState(code).state;
    const markerA = state.getMarkerByName('markerA');

    state.openFile(markerA.fileName);

    // Baseline call with file fully checked.
    state.program.analyzeFile(markerA.fileUri, CancellationToken.None);
    const baselineA = getHoverText(state, 'markerA');
    const baselineB = getHoverText(state, 'markerB');
    assert.strictEqual(
        getHoverSignatureLine(baselineA),
        '(function) def a(f: (**P@a) -> R@a) -> ((**P@a) -> str)',
        `unexpected baseline hover signature for a: ${baselineA}`
    );
    assert.strictEqual(
        getHoverSignatureLine(baselineB),
        '(function) def b(**P@a) -> str',
        `unexpected baseline hover signature for b: ${baselineB}`
    );

    // Trivial edit: insert trailing whitespace after `return b`.
    const file = state.testData.files.find((f) => f.fileUri.key === markerA.fileUri.key);
    assert.ok(file, 'expected to find test file in state');
    const fileText = file.content;
    const target = 'return b\n';
    const offset = fileText.indexOf(target);
    assert.ok(offset >= 0, 'expected to find "return b" in test file');

    state.openFile(file.fileName);
    state.replace(offset + 'return b'.length, 0, ' ');

    // Regression: do not force analysis here. Hover should remain stable.
    const editedA = getHoverText(state, 'markerA');
    const editedB = getHoverText(state, 'markerB');
    assert.strictEqual(
        editedA,
        baselineA,
        `expected hover for a to remain stable after edit: baseline=${baselineA}, edited=${editedA}`
    );
    assert.strictEqual(editedB, baselineB, `expected hover for b to remain stable after edit`);
});

test('hover on self-returning nested function does not recurse infinitely', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/outer|]():
////     def inner():
////         return inner
////     return inner
////
//// outer
`;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    const hover = getHoverText(state, 'marker');
    assert.strictEqual(hover, '```python\n(function) def outer() -> (() -> ...)\n```');
});

test('hover on mutually-recursive nested functions does not recurse infinitely', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/outer|]():
////     def left():
////         return right
////     def right():
////         return left
////     return left
////
//// outer
`;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    const hover = getHoverText(state, 'marker');
    assert.strictEqual(hover, '```python\n(function) def outer() -> (() -> (() -> ...))\n```');
});

function getHoverText(state: TestState, markerName: string): string {
    const marker = state.getMarkerByName(markerName);
    const position = state.convertOffsetToPosition(marker.fileName, marker.position);
    const hover = new HoverProvider(
        state.program,
        marker.fileUri,
        position,
        'markdown',
        CancellationToken.None
    ).getHover();
    assert.ok(hover, `expected hover result for marker ${markerName}`);
    assert.ok(MarkupContent.is(hover.contents), `expected MarkupContent for marker ${markerName}`);
    return hover.contents.value;
}

function getHoverSignatureLine(hover: string): string {
    const lines = hover.split('\n');
    assert.ok(lines.length >= 2, `unexpected hover format: ${hover}`);
    return lines[1];
}
