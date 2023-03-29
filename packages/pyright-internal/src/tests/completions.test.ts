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
    assert.strictEqual(items?.length, 3);

    items.sort((a, b) => a.sortText!.localeCompare(b.sortText!));

    assert(!items[0].labelDetails);
    assert.strictEqual(items[1].labelDetails!.description, 'unused');
    assert.strictEqual(items[2].labelDetails!.description, 'vendored');
});
