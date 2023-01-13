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
