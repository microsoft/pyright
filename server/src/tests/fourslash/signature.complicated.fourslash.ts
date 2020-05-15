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

const xInitSignatures = [
    {
        label: '(x: bool) -> None',
        parameters: ['x: bool'],
    },
];

const xComplicatedSignatures = [
    {
        label: '(a: int, b: int, c: int = 1234, d: str | None = None, **kwargs) -> int | str',
        parameters: ['a: int', 'b: int', 'c: int = 1234', 'd: str | None = None', '**kwargs'],
    },
];

const xCallSignatures = [
    {
        label: '(z: float) -> complex',
        parameters: ['z: float'],
    },
];

helper.verifySignature({
    init: {
        signatures: xInitSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    c1: {
        signatures: xComplicatedSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    c2: {
        signatures: xComplicatedSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    c3: {
        signatures: xComplicatedSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    cA: {
        signatures: xComplicatedSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    cB: {
        signatures: xComplicatedSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    cX: {
        signatures: xComplicatedSignatures,
        activeParameter: 4,
        activeSignature: 0,
    },
    cD: {
        signatures: xComplicatedSignatures,
        activeParameter: 3,
        activeSignature: 0,
    },
    cZ: {
        signatures: xComplicatedSignatures,
        activeParameter: 4,
        activeSignature: 0,
    },
    call: {
        signatures: xCallSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
});
