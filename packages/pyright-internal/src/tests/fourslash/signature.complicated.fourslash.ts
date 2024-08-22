/// <reference path="typings/fourslash.d.ts" />

// @filename: complicated.py
//// from typing import Any, Optional, Type, Union, TypedDict, Unpack, NotRequired
////
//// class Movie(TypedDict):
////     key1: str
////     key2: NotRequired[int]
////
//// class A:
////     def __init__(self, x: bool): ...
////
////     def __call__(self, z: float) -> complex: ...
////
////     def complicated(self, a: int, b: int, c: int = 1234, d: Optional[str] = None, **kwargs: Any) -> Union[int, str]: ...
////
////     def typeddict(self, a: int, b: int, **kwargs: Unpack[Movie]) -> None: ...
////
//// x = A(True[|/*init1*/|])
////
//// x.complicated([|/*c1*/|])
////
//// x.complicated(1, [|/*c2*/|])
////
//// x.complicated(1, [|/*c3/|], 3)
////
//// x.complicated(1[|/*cA*/|],[|/*cB*/|] 2, 3, x=[|/*cX*/|]123, d="wo[|/*cD*/|]w", z[|/*cZ*/|]=1234)
////
//// x.typeddict(1[|/*tdA*/|], [|/*tdB*/|]2, key1=[|/*tdkey1*/|]'r', key2=[|/*tdkey2*/|]4)
////
//// x([|/*call*/|])
////
//// def get_cls() -> Type[A]:
////     return A
////
//// y = get_cls()
////
//// y(True[|/*init2*/|])

{
    const xInitSignatures = [
        {
            label: '(x: bool) -> A',
            parameters: ['x: bool'],
        },
    ];

    const xComplicatedSignatures = [
        {
            label: '(a: int, b: int, c: int = 1234, d: str | None = None, **kwargs: Any) -> (int | str)',
            parameters: ['a: int', 'b: int', 'c: int = 1234', 'd: str | None = None', '**kwargs: Any'],
        },
    ];

    const xTypedDictSignatures = [
        {
            label: '(a: int, b: int, *, key1: str, key2: int = ...) -> None',
            parameters: ['a: int', 'b: int', '*', 'key1: str', 'key2: int = ...'],
        },
    ];

    const xCallSignatures = [
        {
            label: '(z: float) -> complex',
            parameters: ['z: float'],
        },
    ];

    helper.verifySignature('plaintext', {
        init1: {
            signatures: xInitSignatures,
            activeParameters: [0],
        },
        init2: {
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
        tdA: {
            signatures: xTypedDictSignatures,
            activeParameters: [0],
        },
        tdB: {
            signatures: xTypedDictSignatures,
            activeParameters: [1],
        },
        tdkey1: {
            signatures: xTypedDictSignatures,
            activeParameters: [3],
        },
        tdkey2: {
            signatures: xTypedDictSignatures,
            activeParameters: [4],
        },
    });
}
