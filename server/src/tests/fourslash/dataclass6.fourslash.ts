/// <reference path="fourslash.ts" />

//// # This sample tests the type checker's handling of
//// # synthesized __init__ and __new__ methods for
//// # dataclass classes and their subclasses.
////
//// from dataclasses import dataclass
////
//// @dataclass
//// class A:
////     x: int
////
//// @dataclass(init)
//// class B(A):
////     y: int
////
////     def __init__(self, a: A, y: int):
////         self.__dict__ = a.__dict__
////
//// a = A(3)
//// b = B(a, 5)
////
////
//// # This should generate an error because there is an extra parameter
//// a = A(3, [|/*marker1*/4|])
////
//// # This should generate an error because there is one too few parameters
//// b = [|/*marker2*/B(a)|]
////

helper.verifyDiagnostics({
    marker1: { category: 'error', message: 'Expected 1 positional argument' },
    marker2: { category: 'error', message: `Argument missing for parameter "y"` },
});
