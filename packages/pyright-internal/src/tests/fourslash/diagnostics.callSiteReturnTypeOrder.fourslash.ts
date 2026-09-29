/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def func1():
////     reveal_type([|/*marker1*/func2(1)|])
////     reveal_type([|/*marker2*/func3(1)|])
////     reveal_type([|/*marker3*/func4(1)|])
////     reveal_type([|/*marker4*/func5(1)|])
////
////
//// def func2(a):
////     a = [a]
////     return a
////
////
//// def func3(a):
////     a, b = [a], 0
////     return a
////
////
//// def func4(a):
////     (a := [a])
////     return a
////
////
//// def func5(a):
////     for a in [a]:
////         pass
////     return a

helper.verifyDiagnostics({
    marker1: { category: 'information', message: `Type of "func2(1)" is "list[int]"` },
    marker2: { category: 'information', message: `Type of "func3(1)" is "list[int]"` },
    marker3: { category: 'information', message: `Type of "func4(1)" is "list[int]"` },
    marker4: { category: 'information', message: `Type of "func5(1)" is "int"` },
});
