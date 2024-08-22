/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
////
//// import [|/*marker1*/myLib.module|]
//// import myLib.module1
////
//// from [|/*marker2*/myLib.module|] import foo
//// from myLib import [|/*marker3*/module|]
////
//// from [|/*marker4*/.conflict.module2|] import foo2
//// from .conflict import [|/*marker5*/module2|]
////
//// import [|/*marker6*/myLib.module|] as m1
//// from myLib import [|/*marker7*/module|] as m2
//// from .conflict import [|/*marker8*/module2|] as m3

// @filename: myLib/module.pyi
//// def foo(): ...

// @filename: myLib/module1.pyi
////

// @filename: myLib/module1.py
////

// @filename: conflict/module2.pyi
//// def foo2(): ...

// @filename: conflict/module2.py
// @library: true
////

{
    helper.verifyDiagnostics({
        marker1: {
            category: 'warning',
            message: 'Import "myLib.module" could not be resolved from source',
        },
        marker2: {
            category: 'warning',
            message: 'Import "myLib.module" could not be resolved from source',
        },
        marker3: {
            category: 'warning',
            message: 'Import "myLib.module" could not be resolved from source',
        },
        marker4: {
            category: 'warning',
            message: 'Import ".conflict.module2" could not be resolved from source',
        },
        marker5: {
            category: 'warning',
            message: 'Import ".conflict.module2" could not be resolved from source',
        },
        marker6: {
            category: 'warning',
            message: 'Import "myLib.module" could not be resolved from source',
        },
        marker7: {
            category: 'warning',
            message: 'Import "myLib.module" could not be resolved from source',
        },
        marker8: {
            category: 'warning',
            message: 'Import ".conflict.module2" could not be resolved from source',
        },
    });
}
