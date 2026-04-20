/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "basic"
//// }

// @filename: testLib/py.typed
// @library: true
////

// @filename: testLib/_internal.py
// @library: true
//// GraphClass: int = 1

// @filename: testLib/__init__.py
// @library: true
//// from ._internal import GraphClass
////
//// # Simulate dynamic __all__ construction like dash.dcc does:
//// # __all__ = _components + ["other_symbol"]
//// # where _components comes from a wildcard import
//// _components = ["GraphClass"]
//// __all__ = _components + ["other_symbol"]

// @filename: .src/test1.py
//// # pyright: reportPrivateUsage=true, reportPrivateImportUsage=true
//// # This should NOT show an error because __all__ uses an unsupported form,
//// # so we can't determine if GraphClass is actually in __all__ or not.
//// # Since the module uses a dynamic __all__, we should be permissive.
//// from testLib import GraphClass
//// import testLib
//// testLib.GraphClass

// @ts-ignore
await helper.verifyDiagnostics({});
