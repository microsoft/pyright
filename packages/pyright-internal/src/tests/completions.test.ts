/*
 * completions.test.ts
 *
 * completions tests.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';
import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types';

import { ImportFormat } from '../languageService/autoImporter';
import { CompletionOptions } from '../languageService/completionProvider';
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
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
        autoImport: false,
        extraCommitChars: false,
        importFormat: ImportFormat.Absolute,
        includeUserSymbolsInAutoImport: false,
        triggerCharacter: '"',
    };

    const result = await state.workspace.service.getCompletionsForPosition(
        filePath,
        position,
        state.workspace.rootPath,
        options,
        undefined,
        CancellationToken.None
    );

    assert(result);
    const item = result.completionList.items.find((a) => a.label === '"USD"');
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
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
        autoImport: false,
        extraCommitChars: false,
        importFormat: ImportFormat.Absolute,
        includeUserSymbolsInAutoImport: false,
        triggerCharacter: "'",
    };

    const result = await state.workspace.service.getCompletionsForPosition(
        filePath,
        position,
        state.workspace.rootPath,
        options,
        undefined,
        CancellationToken.None
    );

    assert.strictEqual(result?.completionList.items.length, 0);
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
    const position = state.convertOffsetToPosition(filePath, marker.position);

    const options: CompletionOptions = {
        format: 'markdown',
        snippet: false,
        lazyEdit: false,
        autoImport: true,
        extraCommitChars: false,
        importFormat: ImportFormat.Absolute,
        includeUserSymbolsInAutoImport: true,
    };

    const result = await state.workspace.service.getCompletionsForPosition(
        filePath,
        position,
        state.workspace.rootPath,
        options,
        undefined,
        CancellationToken.None
    );

    const items = result?.completionList.items.filter((i) => i.label === 'os');
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
                        newText: 'foo(self, x: list[int]) -> int:\n    return super().foo(x)',
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
                        newText: 'foo(self, x: tuple[int, T3]) -> int:\n    return super().foo(x)',
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
                        newText: 'foo(self, x: tuple[int, int]) -> int:\n    return super().foo(x)',
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
                    additionalTextEdits: [
                        {
                            range: {
                                start: {
                                    line: 0,
                                    character: 27,
                                },
                                end: {
                                    line: 0,
                                    character: 27,
                                },
                            },
                            newText: ', ArgumentParser, Namespace',
                        },
                        {
                            range: {
                                start: {
                                    line: 0,
                                    character: 27,
                                },
                                end: {
                                    line: 0,
                                    character: 27,
                                },
                            },
                            newText: '\nfrom collections.abc import Sequence\nfrom typing import Any',
                        },
                    ],
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

test('fallback to syntax', async () => {
    const code = `
// @filename: test.py
//// class A:
////     def foo(self, a: MyType) -> NewMyType:
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
                        newText: 'foo(self, a: MyType) -> NewMyType:\n    return super().foo(a)',
                    },
                },
            ],
        },
    });
});

test('omit Unknown', async () => {
    const code = `
// @filename: test.py
//// class A:
////     def foo(self, a: list) -> None:
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
                        newText: 'foo(self, a: list) -> None:\n    return super().foo(a)',
                    },
                },
            ],
        },
    });
});

test('no annotation, no return type', async () => {
    const code = `
// @filename: test.py
//// class A:
////     def foo(self):
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
                        newText: 'foo(self):\n    return super().foo()',
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

test('adding import for type arguments', async () => {
    const code = `
// @filename: __builtins__.pyi
//// class MyBuiltIns: ...

// @filename: test.py
//// from typing import Generic, TypeVar
//// 
//// T = TypeVar("T")
//// 
//// class A(Generic[T]):
////     def foo(self, a: T) -> T:
////         return a
//// 
//// class Action:
////     pass
////
//// class B(A[Action]):
////     pass
//// 
//// class C(A[MyBuiltIns]):
////     pass

// @filename: test1.py
//// from test import B
//// 
//// class U(B):
////     def [|foo/*marker1*/|]

// @filename: test2.py
//// from test import C
//// 
//// class U(C):
////     def [|foo/*marker2*/|]
    `;

    const state = parseAndGetTestState(code).state;

    state.openFiles(state.testData.files.map((f) => f.fileName));

    await state.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker1'),
                        newText: 'foo(self, a: Action) -> Action:\n    return super().foo(a)',
                    },
                    additionalTextEdits: [
                        {
                            range: {
                                start: {
                                    line: 0,
                                    character: 18,
                                },
                                end: {
                                    line: 0,
                                    character: 18,
                                },
                            },
                            newText: ', Action',
                        },
                    ],
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: 'foo',
                    kind: CompletionItemKind.Method,
                    textEdit: {
                        range: state.getPositionRange('marker2'),
                        newText: 'foo(self, a: MyBuiltIns) -> MyBuiltIns:\n    return super().foo(a)',
                    },
                    additionalTextEdits: [],
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
                        newText:
                            'foo(self, a: Tuple[list, dict] | tuple[Mapping[List[A[int]], Dict[str, Any]], float]) -> Tuple[list, dict] | tuple[Mapping[List[A[int]], Dict[str, Any]], float]:\n    return super().foo(a)',
                    },
                    additionalTextEdits: [
                        {
                            range: {
                                start: {
                                    line: 0,
                                    character: 17,
                                },
                                end: {
                                    line: 0,
                                    character: 17,
                                },
                            },
                            newText: 'A, ',
                        },
                        {
                            range: {
                                start: {
                                    line: 0,
                                    character: 0,
                                },
                                end: {
                                    line: 0,
                                    character: 0,
                                },
                            },
                            newText: 'from typing import Any, Dict, List, Mapping, Tuple\n',
                        },
                    ],
                },
            ],
        },
    });
});
