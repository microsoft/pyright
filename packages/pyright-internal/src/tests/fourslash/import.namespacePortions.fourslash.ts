/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "basic",
////   "extraPaths": ["p1"],
////   "reportPrivateImportUsage": "error"
//// }

// @filename: p1/ns/a.py
//// def f() -> int: return 1

// @filename: ns/b/py.typed
// @library: true
////

// @filename: ns/b/__init__.py
// @library: true
//// from .defs import secret
//// from .defs import public as public

// @filename: ns/b/defs.py
// @library: true
//// def secret() -> int: return 1
//// def public() -> str: return "x"

// @filename: .src/bootstrap.py
//// from typing import assert_type
//// from ns import a, b
//// from ns import *
//// assert_type(a.f(), int)
//// assert_type(b.public(), str)

// @filename: .src/main.py
//// from ns.b import [|/*privateImport*/secret|]
//// import ns.b as child
//// child.[|/*privateAccess*/secret|]()

// @ts-ignore
await helper.verifyDiagnostics({
    privateImport: {
        category: 'error',
        message: `"secret" is not exported from module "ns.b"\n  Import from "ns.b.defs" instead`,
    },
    privateAccess: { category: 'error', message: `"secret" is not exported from module "ns.b"` },
});
