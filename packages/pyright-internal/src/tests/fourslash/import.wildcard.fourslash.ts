/// <reference path="typings/fourslash.d.ts" />

// @filename: testpkg/py.typed
// @library: true
////

// @filename: testpkg/__init__.py
// @library: true
//// __all__ = ["submod"]
//// def foo():
////    return

// @filename: testpkg/submod.py
// @library: true
//// def test_func():
////     print("hi")

// @filename: .src/test.py
//// # pyright: reportWildcardImportFromLibrary=false
//// from testpkg import *
//// submod.test_func()
//// [|/*marker*/foo|]()

// @ts-ignore
await helper.verifyDiagnostics({
    marker: { category: 'error', message: `"foo" is not defined` },
});
