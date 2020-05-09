/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

helper.verifyCompletion('included', { marker: { completions: [] } });
