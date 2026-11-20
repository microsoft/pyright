/// <reference path="typings/fourslash.d.ts" />

// @filename: test_pkg/py.typed
// @library: true
////

// @filename: test_pkg/__init__.py
// @library: true
////
//// from .submodule1 import MyClass as MyClass
////

// @filename: test_pkg/submodule1.py
// @library: true
////
//// from abc import ABC, abstractmethod
////
//// class MyBaseClass(ABC):
////     """Base class docstring."""
////
////     @abstractmethod
////     def method1(self) -> None:
////         """method1 docstring."""
////         ...
////
//// class MyMixin(MyBaseClass):
////     @abstractmethod
////     def method2(self) -> None:
////         """method2 docstring."""
////         ...
////
//// class MyClass(MyMixin):
////     def method1(self) -> None:
////         ...
////
////     def method2(self) -> None:
////         ...

{
    helper.verifyTypeVerifierResults('test_pkg', /* ignoreUnknownTypesFromImports */ false, /* verboseOutput */ false, {
        generalDiagnostics: [],
        missingClassDocStringCount: 0,
        missingDefaultParamCount: 0,
        missingFunctionDocStringCount: 0,
        moduleName: 'test_pkg',
        packageName: 'test_pkg',
        modules: new Map<string, object>([
            ['/lib/site-packages/test_pkg/__init__.py', {}],
            ['/lib/site-packages/test_pkg/submodule1.py', {}],
        ]),
        symbols: new Map<string, object>([
            ['test_pkg.submodule1', {}],
            ['test_pkg.submodule1.MyBaseClass', {}],
            ['test_pkg.submodule1.MyBaseClass.method1', {}],
            ['test_pkg.submodule1.MyMixin', {}],
            ['test_pkg.submodule1.MyMixin.method2', {}],
            ['test_pkg.submodule1.MyClass', {}],
            ['test_pkg.submodule1.MyClass.method1', {}],
            ['test_pkg.submodule1.MyClass.method2', {}],
            ['test_pkg.MyClass', {}],
        ]),
    });
}
