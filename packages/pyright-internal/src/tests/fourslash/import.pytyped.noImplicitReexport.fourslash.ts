/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "basic",
////   "noImplicitReexport": false
//// }

// @filename: testLib/py.typed
// @library: true
////

// @filename: testLib/__init__.py
// @library: true
//// from .module1 import one as one, two, three

// @filename: testLib/module1.py
// @library: true
//// one: int = 1
//// two: int = 2
//// three: int = 3

// @filename: .src/test1.py
//// # pyright: reportPrivateImportUsage=true
//// from testLib import one    # explicit re-export (as-alias) — always ok
//// from testLib import two    # plain import, public name — ok with noImplicitReexport=false
//// from testLib import three  # plain import, public name — ok with noImplicitReexport=false
//// import testLib
//// testLib.one
//// testLib.two    # ok with noImplicitReexport=false
//// testLib.three  # ok with noImplicitReexport=false

// Verify that no reportPrivateImportUsage errors are raised for public names
// when noImplicitReexport=false. Private-name behavior is tested in privateImportUsage.test.ts.
// @ts-ignore
await helper.verifyDiagnostics();
