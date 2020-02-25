/// <reference path="fourslash.ts" />

// @filename: mspythonconfig.json
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
//// import [|/*marker*/testLi|]b

helper.verifyDiagnostics({
    marker: { category: 'warning', message: "Stub file not found for 'testLib'" }
});
