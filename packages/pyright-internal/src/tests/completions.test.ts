/*
 * completions.test.ts
 *
 * completions tests.
 */

import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types';

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
