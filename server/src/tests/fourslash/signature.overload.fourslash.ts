/// <reference path="fourslash.ts" />

// @filename: overloaded.py
//// from typing import overload
////
//// @overload
//// def foo(x: int) -> int: ...
////
//// @overload
//// def foo(x: int, y: int) -> str: ...
////
//// def foo(*args): ...
////
//// foo(1[|/*o1*/|], 2[|/*o2*/|])
////
//// foo(1, 2, [|/*o3*/|])
////
//// foo(1, 2, someVar[|/*o4*/|]   , 4, 5, 6, 7, 8)

const overloadedSignatures = [
    {
        label: '(x: int) -> int',
        parameters: ['x: int'],
    },
    {
        label: '(x: int, y: int) -> str',
        parameters: ['x: int', 'y: int'],
    },
    {
        label: '(*args) -> None',
        parameters: ['*args'],
    },
];

helper.verifySignature({
    o1: {
        signatures: overloadedSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    o2: {
        signatures: overloadedSignatures,
        activeParameter: 1,
        activeSignature: 1,
    },
    o3: {
        signatures: overloadedSignatures,
        activeParameter: 0,
        activeSignature: 2,
    },
    o4: {
        signatures: overloadedSignatures,
        activeParameter: 0,
        activeSignature: 2,
    },
});
