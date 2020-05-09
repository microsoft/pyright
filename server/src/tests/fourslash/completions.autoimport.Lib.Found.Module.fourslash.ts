/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: test1.py
//// testLib[|/*marker*/|]

// @filename: test2.py
//// import testLib

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

helper.verifyCompletion('included', {
    marker: {
        completions: [
            {
                label: 'testLib',
                documentation: {
                    kind: 'markdown',
                    value: 'Auto-import from lib.site-packages\n\n```python\ntestLib\n```\n',
                },
            },
        ],
    },
});
