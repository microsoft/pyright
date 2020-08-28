/// <reference path="fourslash.ts" />

// @filename: test1.py
//// MyShadow[|/*marker*/|]

// @filename: test2.py
//// import testLib
//// a = testLib.MyShadow()
//// a.[|/*hover*/method|]()

// @filename: testLib/__init__.pyi
// @library: true
//// class MyShadow:
////     def method(): ...

// @filename: testLib/__init__.py
// @library: true
//// class MyShadow:
////     def method():
////         'doc string'
////         pass

// This will cause shadow file to be injected.
helper.openFile(helper.getMarkerByName('hover').fileName);
helper.verifyHover({
    hover: {
        value: '```python\n(method) method: () -> Unknown\n```\ndoc string',
        kind: 'markdown',
    },
});

// @ts-ignore
await helper.verifyCompletion('exact', {
    marker: {
        completions: [
            {
                label: 'MyShadow',
                documentation: {
                    kind: 'markdown',
                    value: 'Auto-import\n\n```\nfrom testLib import MyShadow\n```',
                },
            },
        ],
    },
});
