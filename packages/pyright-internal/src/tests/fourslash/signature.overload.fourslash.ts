/// <reference path="typings/fourslash.d.ts" />

// @filename: overloaded.py
//// from typing import overload
////
//// @overload
//// def foo() -> int: ...
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
////
//// foo([|/*o5*/|])

{
    const overloadedSignatures = [
        {
            label: '() -> int',
            parameters: [],
        },
        {
            label: '(x: int) -> int',
            parameters: ['x: int'],
        },
        {
            label: '(x: int, y: int) -> str',
            parameters: ['x: int', 'y: int'],
        },
    ];

    helper.verifySignature('plaintext', {
        o1: {
            signatures: overloadedSignatures,
            activeParameters: [undefined, 0, 0],
        },
        o2: {
            signatures: overloadedSignatures,
            activeParameters: [undefined, undefined, 1],
        },
        o3: {
            signatures: overloadedSignatures,
            activeParameters: [undefined, undefined, undefined],
        },
        o4: {
            signatures: overloadedSignatures,
            activeParameters: [undefined, undefined, undefined],
        },
        o5: {
            signatures: overloadedSignatures,
            activeParameters: [undefined, 0, 0],
            callHasParameters: false,
        },
    });
}
