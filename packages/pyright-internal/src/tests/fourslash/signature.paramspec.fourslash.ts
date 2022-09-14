/// <reference path="fourslash.ts" />

// @filename: sig_paramspec.py
//// from typing import Callable, Concatenate, ParamSpec
////
////
//// P = ParamSpec("P")
//// def tester(c: Callable[Concatenate[int, str, P], None]) -> Callable[Concatenate[int, P], None]:
////     pass
////
//// @tester
//// def foo(a: int, b: str, c: str, d: str):
////     pass
////
//// foo(1,[|/*s1*/|])

{
    const simpleSignatures = [
        {
            label: '(int, c: str, d: str) -> None',
            parameters: ['int', 'c: str', 'd: str'],
        },
    ];

    helper.verifySignature('plaintext', {
        s1: {
            signatures: simpleSignatures,
            activeParameters: [1],
        },
    });
}
