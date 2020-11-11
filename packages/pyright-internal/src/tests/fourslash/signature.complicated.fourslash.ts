/// <reference path="fourslash.ts" />

// @filename: complicated.py
//// from typing import Any, Optional, Union
////
//// class A:
////     def __init__(self, x: bool): ...
////
////     def __call__(self, z: float) -> complex: ...
////
////     def complicated(self, a: int, b: int, c: int = 1234, d: Optional[str] = None, **kwargs: Any) -> Union[int, str]: ...
////
//// x = A(True[|/*init*/|])
////
//// x.complicated([|/*c1*/|])
////
//// x.complicated(1, [|/*c2*/|])
////
//// x.complicated(1, [|/*c3/|], 3)
////
//// x.complicated(1[|/*cA*/|],[|/*cB*/|] 2, 3, x=[|/*cX*/|]123, d="wo[|/*cD*/|]w", z[|/*cZ*/|]=1234)
////
//// x([|/*call*/|])

{
    const xInitSignatures = [
        {
            label: '(x: bool) -> None',
            parameters: ['x: bool'],
        },
    ];

    const xComplicatedSignatures = [
        {
            label: '(a: int, b: int, c: int = 1234, d: str | None = None, **kwargs: Any) -> int | str',
            parameters: ['a: int', 'b: int', 'c: int = 1234', 'd: str | None = None', '**kwargs: Any'],
        },
    ];

    const xCallSignatures = [
        {
            label: '(z: float) -> complex',
            parameters: ['z: float'],
        },
    ];

    helper.verifySignature('plaintext', {
        init: {
            signatures: xInitSignatures,
            activeParameters: [0],
        },
        c1: {
            signatures: xComplicatedSignatures,
            activeParameters: [0],
        },
        c2: {
            signatures: xComplicatedSignatures,
            activeParameters: [1],
        },
        c3: {
            signatures: xComplicatedSignatures,
            activeParameters: [1],
        },
        cA: {
            signatures: xComplicatedSignatures,
            activeParameters: [0],
        },
        cB: {
            signatures: xComplicatedSignatures,
            activeParameters: [1],
        },
        cX: {
            signatures: xComplicatedSignatures,
            activeParameters: [4],
        },
        cD: {
            signatures: xComplicatedSignatures,
            activeParameters: [3],
        },
        cZ: {
            signatures: xComplicatedSignatures,
            activeParameters: [4],
        },
        call: {
            signatures: xCallSignatures,
            activeParameters: [0],
        },
    });
}
