/// <reference path="typings/fourslash.d.ts" />

// @filename: test_pkg/py.typed
// @library: true
////

// @filename: test_pkg/__init__.py
// @library: true
////
//// from .submodule1 import A as A
//// from ._submodule2 import B as B, func1 as func1
////

// @filename: test_pkg/submodule1.py
// @library: true
////
//// class A:
////     ...

// @filename: test_pkg/_submodule2.py
// @library: true
////
//// class B:
////     ...
////
//// def func1(a: int = ...) -> None:
////     ...

{
    helper.verifyTypeVerifierResults('test_pkg', /* ignoreUnknownTypesFromImports */ false, /* verboseOutput */ false, {
        generalDiagnostics: [],
        missingClassDocStringCount: 4,
        missingDefaultParamCount: 1,
        missingFunctionDocStringCount: 1,
        moduleName: 'test_pkg',
        packageName: 'test_pkg',
        modules: new Map<string, object>([
            ['/lib/site-packages/test_pkg/__init__.py', {}],
            ['/lib/site-packages/test_pkg/submodule1.py', {}],
        ]),
        symbols: new Map<string, object>([
            ['test_pkg.submodule1', {}],
            ['test_pkg.submodule1.A', {}],
            ['test_pkg.A', {}],
            ['test_pkg.B', {}],
            ['test_pkg._submodule2.B', {}],
            ['test_pkg.func1', {}],
        ]),
    });
}
