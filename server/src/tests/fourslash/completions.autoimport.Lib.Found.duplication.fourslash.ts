/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: test1.py
//// testLib[|/*marker*/|]

// @filename: test2.py
//// import testLib
//// import testLib.test1
//// import testLib.test2
//// a = testLib.test1.Test1()
//// b = testLib.test2.Test2()

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

// @filename: testLib/test1.pyi
// @library: true
//// class Test1:
////     pass

// @filename: testLib/test2.pyi
// @library: true
//// class Test2:
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
