/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "basic"
//// }

// @filename: testLib/py.typed
// @library: true
////

// @filename: testLib/__init__.py
// @library: true
//// from .module1 import one as one, two, three
//// from ._module2 import ten as ten
//// four: int = two * two
//// _five: int = two + three
//// _six: int = 6
//// from . import _module3 as _module3
//// __all__ = ["_six", "_module4"]

// @filename: testLib/module1.py
// @library: true
//// one: int = 1
//// two: int = 2
//// three: int = 3

// @filename: testLib/_module2/__init__.py
// @library: true
//// ten: int = 10

// @filename: testLib/_module3/__init__.py
// @library: true
//// eleven: int = 11

// @filename: testLib/_module4/__init__.py
// @library: true
//// twelve: int = 12

// @filename: .src/test1.py
//// # pyright: reportPrivateUsage=true, reportPrivateImportUsage=true
//// from testLib import one
//// from testLib import [|/*marker1*/two|] as two_alias
//// from testLib import [|/*marker2*/three|]
//// from testLib import four
//// from testLib import [|/*marker3*/_five|]
//// from testLib import _six
//// import testLib
//// testLib.one
//// testLib.[|/*marker4*/two|]
//// testLib.[|/*marker5*/three|]
//// testLib.four
//// testLib.[|/*marker6*/_five|]
//// testLib._six
////
//// from testLib.[|/*marker7*/_module2|] import ten
//// from testLib import ten
//// import testLib.[|/*marker8*/_module2|]
//// import testLib._module3
//// import testLib._module4
//// testLib.ten
//// testLib._module3.eleven
//// testLib._module4.twelve

// @ts-ignore
await helper.verifyDiagnostics({
    marker1: {
        category: 'error',
        message: `"two" is not exported from module "testLib"\n  Import from \"testLib.module1\" instead`,
    },
    marker2: {
        category: 'error',
        message: `"three" is not exported from module "testLib"\n  Import from \"testLib.module1\" instead`,
    },
    marker3: {
        category: 'error',
        message: `"_five" is private and used outside of the module in which it is declared`,
    },
    marker4: { category: 'error', message: `"two" is not exported from module "testLib"` },
    marker5: {
        category: 'error',
        message: `"three" is not exported from module "testLib"`,
    },
    marker6: {
        category: 'error',
        message: `"_five" is private and used outside of the module in which it is declared`,
    },
    marker7: {
        category: 'error',
        message: `"_module2" is not publicly exported from module "testLib"`,
    },
    marker8: {
        category: 'error',
        message: `"_module2" is not publicly exported from module "testLib"`,
    },
});
