/*
 * completions.test.ts
 *
 * completions tests.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';
import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types';

import { Uri } from '../common/uri/uri';
import { CompletionOptions, CompletionProvider } from '../languageService/completionProvider';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('completion import statement tooltip', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import [|/*marker*/m|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: 'matplotlib',
                },
            ],
        },
    });
});

test('completion import statement tooltip - stub file', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import [|/*marker*/m|]

// @filename: matplotlib/__init__.pyi
// @library: true
//// # empty

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: 'matplotlib',
                },
            ],
        },
    });
});

test('completion import statement tooltip - doc in stub file', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import [|/*marker*/m|]

// @filename: matplotlib/__init__.pyi
// @library: true
//// """ matplotlib """

// @filename: matplotlib/__init__.py
// @library: true
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: 'matplotlib',
                },
            ],
        },
    });
});

test('completion import statement tooltip - sub modules', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib.[|/*marker*/p|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'pyplot',
                    documentation: 'pyplot',
                },
            ],
        },
    });
});

test('completion import reference tooltip', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib
//// [|/*marker*/m|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: '```python\nmatplotlib\n```\n---\nmatplotlib',
                },
            ],
        },
    });
});

test('completion import reference tooltip - first module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib.pyplot
//// [|/*marker*/m|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: '```python\nmatplotlib\n```\n---\nmatplotlib',
                },
            ],
        },
    });
});

test('completion import reference tooltip - child module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import matplotlib.pyplot
//// matplotlib.[|/*marker*/p|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'pyplot',
                    documentation: '```python\npyplot\n```\n---\npyplot',
                },
            ],
        },
    });
});

test('completion from import statement tooltip - first module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from [|/*marker*/m|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'matplotlib',
                    documentation: 'matplotlib',
                },
            ],
        },
    });
});

test('completion from import statement tooltip - child module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from matplotlib.[|/*marker*/p|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'pyplot',
                    documentation: 'pyplot',
                },
            ],
        },
    });
});

test('completion from import statement tooltip - implicit module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// from matplotlib import [|/*marker*/p|]

// @filename: matplotlib/__init__.py
// @library: true
//// """ matplotlib """

// @filename: matplotlib/pyplot.py
// @library: true
//// """ pyplot """
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'pyplot',
                    documentation: 'pyplot',
                },
            ],
        },
    });
});

test('include literals in expression completion', async () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// 
//// class TestType(TypedDict):
////     A: str
////     B: int
//// 
//// var: TestType = {}
//// 
//// var[[|A/*marker*/|]]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: "'A'",
                    textEdit: { range: state.getPositionRange('marker'), newText: "'A'" },
                },
            ],
        },
    });
});

test('include literals in set key', async () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// 
//// class TestType(TypedDict):
////     A: str
////     B: int
//// 
//// var: TestType = { [|A/*marker*/|] }
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: "'A'",
                    textEdit: { range: state.getPositionRange('marker'), newText: "'A'" },
                },
            ],
        },
    });
});

test('include literals in dict key', async () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// 
//// class TestType(TypedDict):
////     A: str
////     B: int
//// 
//// var: TestType = { [|A/*marker*/|] : "hello" }
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"A"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"A"' },
                },
            ],
        },
    });
});

test('literals support for binary operators - equals', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     if c == [|"/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('literals support for binary operators - not equals', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     if c != [|"/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('literals support for binary operators without string node', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     if c != [|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                },
            ],
        },
    });
});

test('literals support for binary operators with prior word', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     if c != [|US/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                },
            ],
        },
    });
});

test('literals support for binary operators - assignment expression', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     if c := [|"/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('literals support for call', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency) -> Currency:
////     return c
////
//// if foo([|"/*marker1*/"|]) == [|"/*marker2*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker1 = state.getMarkerByName('marker1');
    state.openFile(marker1.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker1: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker1'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker1'), newText: '"EUR"' },
                },
            ],
        },
        marker2: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker2'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker2'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('list with literal types', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// a: list[Currency] = [[|"/*marker*/"|]]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('literals support for match - error case', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     match c:
////         case [|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                },
            ],
        },
    });
});

test('literals support for match - simple case', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     match c:
////         case [|"/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"USD"' },
                },
                {
                    kind: CompletionItemKind.Constant,
                    label: '"EUR"',
                    textEdit: { range: state.getPositionRange('marker'), newText: '"EUR"' },
                },
            ],
        },
    });
});

test('literals support for match - simple case without string', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     match c:
////         case [|US/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Constant,
                    label: '"USD"',
                },
            ],
        },
    });
});

test('completion quote trigger', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["USD", "EUR"]
//// 
//// def foo(c: Currency):
////     match c:
////         case [|"/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    const filePath = marker.fileName;
    const uri = Uri.file(filePath, state.serviceProvider);
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
        triggerCharacter: '"',
    };

    const result = new CompletionProvider(
        state.program,
        uri,
        position,
        options,
        CancellationToken.None
    ).getCompletions();

    assert(result);
    const item = result.items.find((a) => a.label === '"USD"');
    assert(item);
});

test('completion quote trigger - middle', async () => {
    const code = `
// @filename: test.py
//// from typing import Literal
//// 
//// Currency = Literal["Quote'Middle"]
//// 
//// def foo(c: Currency):
////     match c:
////         case [|"Quote'/*marker*/"|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    const filePath = marker.fileName;
    const uri = Uri.file(filePath, state.serviceProvider);
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
        triggerCharacter: "'",
    };

    const result = new CompletionProvider(
        state.program,
        uri,
        position,
        options,
        CancellationToken.None
    ).getCompletions();

    assert.strictEqual(result?.items.length, 0);
});

test('auto import sort text', async () => {
    const code = `
// @filename: test.py
//// [|os/*marker*/|]

// @filename: unused.py
//// import os
//// p = os.path

// @filename: vendored/__init__.py
// @library: true
//// # empty

// @filename: vendored/os.py
// @library: true
//// def foo(): pass
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFiles(state.testData.files.map((f) => f.fileName));

    while (state.workspace.service.test_program.analyze());

    const filePath = marker.fileName;
    const uri = Uri.file(filePath, state.serviceProvider);
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
    };

    const result = new CompletionProvider(
        state.program,
        uri,
        position,
        options,
        CancellationToken.None
    ).getCompletions();

    const items = result?.items.filter((i) => i.label === 'os');
    assert.strictEqual(items?.length, 2);

    items.sort((a, b) => a.sortText!.localeCompare(b.sortText!));

    assert(!items[0].labelDetails);
    assert.strictEqual(items[1].labelDetails!.description, 'vendored');
});

test('override generic', async () => {
    const code = `
// @filename: test.py
//// from typing import Generic, TypeVar
//// from typing_extensions import override
//// 
//// T = TypeVar('T')
//// class A(Generic[T]):
////     def foo(self, x: list[T]) -> T:
////         return x
////     
//// class B(A[int]):
////     @override
////     def [|foo/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker'),
                        newText: 'foo(self, x: list[T]) -> T:\n    return super().foo(x)',
                    },
                },
            ],
        },
    });
});

test('override generic nested', async () => {
    const code = `
// @filename: test.py
//// from typing import Generic, TypeVar
//// from typing_extensions import override
//// 
//// T = TypeVar('T')
//// T2 = TypeVar('T2')
//// class A(Generic[T, T2]):
////     def foo(self, x: tuple[T, T2]) -> T:
////         return x
////     
//// 
//// T3 = TypeVar('T3')
//// class B(A[int, T3]):
////     @override
////     def [|foo/*marker1*/|]
////     
//// class C(B[int]):
////     @override
////     def [|foo/*marker2*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker1']: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker1'),
                        newText: 'foo(self, x: tuple[T, T2]) -> T:\n    return super().foo(x)',
                    },
                },
            ],
        },
        ['marker2']: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker2'),
                        newText: 'foo(self, x: tuple[T, T2]) -> T:\n    return super().foo(x)',
                    },
                },
            ],
        },
    });
});

test('override __call__', async () => {
    const code = `
// @filename: test.py
//// from argparse import Action
//// 
//// class MyAction(Action):
////     def [|__call__/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: '__call__',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker'),
                        newText:
                            '__call__(self, parser: ArgumentParser, namespace: Namespace, values: str | Sequence[Any] | None, option_string: str | None = None) -> None:\n    return super().__call__(parser, namespace, values, option_string)',
                    },
                },
            ],
        },
    });
});

test('override ParamSpec', async () => {
    const code = `
// @filename: test.py
//// from typing import Callable, ParamSpec
////
//// P = ParamSpec("P")
////
//// class A:
////     def foo(self, func: Callable[P, None], *args: P.args, **kwargs: P.kwargs):
////         pass
//// 
//// class B(A):
////     def [|foo/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker'),
                        newText:
                            'foo(self, func: Callable[P, None], *args: P.args, **kwargs: P.kwargs):\n    return super().foo(func, *args, **kwargs)',
                    },
                },
            ],
        },
    });
});

test('annotation using comment', async () => {
    const code = `
// @filename: test.py
//// class A:
////     def foo(self, a): # type: (int) -> None
////         pass
//// 
//// class B(A):
////     def [|foo/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker'),
                        newText: 'foo(self, a: int) -> None:\n    return super().foo(a)',
                    },
                },
            ],
        },
    });
});

test('Complex type arguments', async () => {
    const code = `
// @filename: test.py
//// from typing import Generic, TypeVar, Any, List, Dict, Tuple, Mapping, Union
//// 
//// T = TypeVar("T")
//// 
//// class A(Generic[T]):
////     def foo(self, a: T) -> T:
////         return a
////
//// class B(A[Union[Tuple[list, dict], tuple[Mapping[List[A[int]], Dict[str, Any]], float]]]):
////     pass

// @filename: test1.py
//// from test import B
//// 
//// class U(B):
////     def [|foo/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    state.openFiles(state.testData.files.map((f) => f.fileName));

    await state.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker'),
                        newText: 'foo(self, a: T) -> T:\n    return super().foo(a)',
                    },
                },
            ],
        },
    });
});

test('Enum member', async () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// 
//// class MyEnum(Enum):
////     this = 1
////     that = 2
//// 
//// print(MyEnum.[|/*marker*/|])
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'this',
                    kind: CompletionItemKind.EnumMember,
                    documentation: '```python\nthis: int\n```',
                },
            ],
        },
    });
});

test('no member of Enum member', async () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// 
//// class MyEnum(Enum):
////     this = 1
////     that = 2
//// 
//// print(MyEnum.this.[|/*marker*/|])
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('excluded', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'this',
                    kind: undefined,
                },
                {
                    label: 'that',
                    kind: undefined,
                },
            ],
        },
    });
});

test('default Enum member', async () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// 
//// class MyEnum(Enum):
////     MemberOne = []
//// 
//// MyEnum.MemberOne.[|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'name',
                    kind: CompletionItemKind.Property,
                },
                {
                    label: 'value',
                    kind: CompletionItemKind.Property,
                },
            ],
        },
    });
});

test('TypeDict literal values', async () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict, Literal
//// 
//// class DataA(TypedDict):
////     name: Literal["a", "b"] | None
//// 
//// data_a: DataA = {
////     "name": [|"/*marker*/"|]
//// }
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: '"a"',
                    kind: CompletionItemKind.Constant,
                    textEdit: { range: state.getPositionRange('marker'), newText: '"a"' },
                },
                {
                    label: '"b"',
                    kind: CompletionItemKind.Constant,
                    textEdit: { range: state.getPositionRange('marker'), newText: '"b"' },
                },
            ],
        },
    });
});

test('typed dict key constructor completion', async () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// 
//// class Movie(TypedDict):
////    key1: str
//// 
//// a = Movie(k[|"/*marker*/"|])
//// 
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    kind: CompletionItemKind.Variable,
                    label: 'key1=',
                },
            ],
        },
    });
});

test('import from completion for namespace package', async () => {
    const code = `
// @filename: test.py
//// from nest1 import [|/*marker*/|]

// @filename: nest1/nest2/__init__.py
//// # empty

// @filename: nest1/module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'nest2',
                    kind: CompletionItemKind.Module,
                },
                {
                    label: 'module',
                    kind: CompletionItemKind.Module,
                },
            ],
        },
    });
});

test('members off enum member', async () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// class Planet(Enum):
////     MERCURY = (3.303e+23, 2.4397e6)
////     EARTH   = (5.976e+24, 6.37814e6)
////
////     def __init__(self, mass, radius):
////         self.mass = mass       # in kilograms
////         self.radius = radius   # in meters
////
////     @property
////     def surface_gravity(self):
////         # universal gravitational constant  (m3 kg-1 s-2)
////         G = 6.67300E-11
////         return G * self.mass / (self.radius * self.radius)
////
//// Planet.EARTH.[|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('excluded', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'MERCURY',
                    kind: CompletionItemKind.EnumMember,
                },
                {
                    label: 'EARTH',
                    kind: CompletionItemKind.EnumMember,
                },
            ],
        },
    });

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'mass',
                    kind: CompletionItemKind.Variable,
                },
                {
                    label: 'radius',
                    kind: CompletionItemKind.Variable,
                },
                {
                    label: 'surface_gravity',
                    kind: CompletionItemKind.Property,
                },
            ],
        },
    });
});

test('handle missing close paren case', async () => {
    const code = `
// @filename: test.py
//// count=100
//// while count <= (c[|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'count',
                    kind: CompletionItemKind.Variable,
                },
            ],
        },
    });
});

test('enum with regular base type', async () => {
    const code = `
// @filename: test.py
//// from enum import Enum
//// from datetime import timedelta
//// class Period(timedelta, Enum):
////     Today = -1
////
//// Period.Today.[|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'days',
                    kind: CompletionItemKind.Property,
                },
                {
                    label: 'seconds',
                    kind: CompletionItemKind.Property,
                },
            ],
        },
    });
});

test('import statements with implicit import', async () => {
    const code = `
// @filename: test.py
//// from lib import /*marker*/

// @filename: lib/__init__.py
//// from . import api as api

// @filename: lib/api.py
//// # Empty
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', 'markdown', {
        ['marker']: {
            completions: [
                {
                    label: 'api',
                    kind: CompletionItemKind.Module,
                },
            ],
        },
    });
});
