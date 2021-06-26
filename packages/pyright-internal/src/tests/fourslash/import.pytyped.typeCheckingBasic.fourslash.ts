/// <reference path="fourslash.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "basic"
//// }

// @filename: testLib/py.typed
// @library: true
////

// @filename: testLib/__init__.py
// @library: true
//// # This method is missing a return annotation
//// def foo():
////    return

// @filename: .src/test.py
//// # pyright: strict
//// from testLib import foo
//// [|/*marker*/a|] = foo()

// @ts-ignore
await helper.verifyDiagnostics({
    marker: { category: 'error', message: `Type of "a" is unknown` },
});
