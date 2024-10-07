/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "reportMissingTypeStubs": "warning"
//// }

// @filename: testLib/__init__.py
// @library: true
//// # This is a library file
//// class MyLibrary:
////     def DoEveryThing(self, code: str):
////         pass

// @filename: test.py
//// import [|/*marker*/testLib|]

helper.verifyDiagnostics({
    marker: { category: 'warning', message: `Stub file not found for "testLib"` },
});
