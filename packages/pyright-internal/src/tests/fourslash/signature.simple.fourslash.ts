/// <reference path="fourslash.ts" />

// @filename: simple.py
////
//// def simple(x: int, y: int) -> int: ...
////
//// simple([|/*s1*/|])[|/*sOutside*/|]
////
//// simple(1, [|/*s2*/|])
////
//// simple( [|/*s3*/|]   1  [|/*s4*/|]  , [|/*s5*/|] 2     [|/*s6*/|]
////   [|/*s7*/|]  )
////
//// x = 1234[|/*sNoCall*/|]

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
        s2: {
            signatures: simpleSignatures,
            activeParameters: [1],
        },
        s3: {
            signatures: simpleSignatures,
            activeParameters: [0],
        },
        s4: {
            signatures: simpleSignatures,
            activeParameters: [0],
        },
        s5: {
            signatures: simpleSignatures,
            activeParameters: [1],
        },
        s6: {
            signatures: simpleSignatures,
            activeParameters: [1],
        },
        s7: {
            signatures: simpleSignatures,
            activeParameters: [1],
        },
        sOutside: {
            noSig: true,
        },
        sNoCall: {
            noSig: true,
        },
    });
}
