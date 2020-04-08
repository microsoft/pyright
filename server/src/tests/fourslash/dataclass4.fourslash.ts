/// <reference path="fourslash.ts" />

//// # This sample tests the handling of the @dataclass decorator.
////
//// from dataclasses import dataclass, InitVar
////
//// @dataclass
//// class Bar():
////     bbb: int
////     ccc: str
////     aaa = 'string'
////
//// bar1 = Bar(bbb=5, ccc='hello')
//// bar2 = Bar(5, 'hello')
//// bar3 = Bar(5, 'hello', 'hello2')
//// print(bar3.bbb)
//// print(bar3.ccc)
//// print(bar3.aaa)
////
//// # This should generate an error because ddd
//// # isn't a declared value.
//// bar = Bar(bbb=5, [|/*marker1*/ddd|]=5, ccc='hello')
////
//// # This should generate an error because the
//// # parameter types don't match.
//// bar = Bar([|/*marker2*/'hello'|], 'goodbye')
////
//// # This should generate an error because a parameter
//// # is missing.
//// bar = [|/*marker3*/Bar(2)|]
////
//// # This should generate an error because there are
//// # too many parameters.
//// bar = Bar(2, 'hello', 'hello', [|/*marker4*/4|])
////
////
//// @dataclass
//// class Baz1():
////     bbb: int
////     aaa = 'string'
////
////     # This should generate an error because variables
////     # with no default cannot come after those with
////     # defaults.
////     [|/*marker5*/ccc|]: str
////
//// @dataclass
//// class Baz2():
////     aaa: str
////     ddd: InitVar[int] = 3

helper.verifyDiagnostics({
    marker1: { category: 'error', message: `No parameter named "ddd"` },
    marker2: {
        category: 'error',
        message: `Argument of type "Literal['hello']" cannot be assigned to parameter "bbb" of type "int"\n  "str" is incompatible with "int"`,
    },
    marker3: { category: 'error', message: `Argument missing for parameter "ccc"` },
    marker4: { category: 'error', message: 'Expected 3 positional arguments' },
    marker5: {
        category: 'error',
        message: 'Data fields without default value cannot appear after data fields with default values',
    },
});
