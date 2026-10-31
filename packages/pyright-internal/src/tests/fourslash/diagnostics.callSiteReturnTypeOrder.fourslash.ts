/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import overload
////
////
//// @overload
//// def select(b: int) -> bytes: ...
//// @overload
//// def select(b: str) -> float: ...
//// def select(b: int | str) -> bytes | float: ...
////
////
//// def func1():
////     reveal_type([|/*marker1*/func2(1)|])
////     reveal_type([|/*marker2*/func3(1)|])
////     reveal_type([|/*marker3*/func4(1)|])
////     reveal_type([|/*marker4*/func5(1)|])
////     reveal_type([|/*marker5*/func6(1)|])
////     reveal_type([|/*marker6*/func6("")|])
////     reveal_type([|/*marker7*/func7(1)|])
////     reveal_type([|/*marker8*/func7("")|])
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
////
////
//// def func6(a):
////     a = select(a)
////     a = [a]
////     return a
////
////
//// def func7(a):
////     b = select(a)
////     return [b]

helper.verifyDiagnostics({
    marker1: { category: 'information', message: `Type of "func2(1)" is "list[int]"` },
    marker2: { category: 'information', message: `Type of "func3(1)" is "list[int]"` },
    marker3: { category: 'information', message: `Type of "func4(1)" is "list[int]"` },
    marker4: { category: 'information', message: `Type of "func5(1)" is "int"` },
    marker5: { category: 'information', message: `Type of "func6(1)" is "list[bytes]"` },
    marker6: { category: 'information', message: `Type of "func6("")" is "list[float]"` },
    marker7: { category: 'information', message: `Type of "func7(1)" is "list[bytes]"` },
    marker8: { category: 'information', message: `Type of "func7("")" is "list[float]"` },
});
