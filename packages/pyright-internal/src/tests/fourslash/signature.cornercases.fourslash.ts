/// <reference path="typings/fourslash.d.ts" />

// @filename: simple.py
////
//// def simple(x: int, y: int) -> int: ...
////
//// simple([|/*s1*/|]

{
    const simpleSignatures = [
        {
            label: '(x: int, y: int) -> int',
            parameters: ['x: int', 'y: int'],
        },
    ];

    helper.verifySignature('plaintext', {
        s1: {
            signatures: simpleSignatures,
            activeParameters: [0],
        },
    });
}
