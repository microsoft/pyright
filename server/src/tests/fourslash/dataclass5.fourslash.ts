/// <reference path="fourslash.ts" />

//// # This sample tests the handling of the @dataclass decorator
//// # with a custom __init__.
////
//// from dataclasses import dataclass
////
//// @dataclass(init=False)
//// class A:
////     x: int
////     x_squared: int
////
////     def __init__(self, x: int):
////         self.x = x
////         self.x_squared = x ** 2
////
//// a = A(3)
////
//// @dataclass(init=True)
//// class B:
////     x: int
////     x_squared: int
////
////     def __init__(self, x: int):
////         self.x = x
////         self.x_squared = x ** 2
////
//// b = B(3)
////
//// @dataclass()
//// class C:
////     x: int
////     x_squared: int
////
////     def __init__(self, x: int):
////         self.x = x
////         self.x_squared = x ** 2
////
//// c = C(3)
////
//// @dataclass(init=False)
//// class D:
////     x: int
////     x_squared: int
////
//// # This should generate an error because there is no
//// # override __init__ method and no synthesized __init__.
//// d = [|/*marker1*/[|/*marker2*/D(3|]|])

helper.verifyDiagnostics({
    marker1: { category: 'error', message: `Expected no arguments to "D" constructor` },
    marker2: { category: 'error', message: `"D(3)" has type "Type[D]" and is not callable` },
});
