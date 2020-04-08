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

const simpleSignatures = [
    {
        label: '(x: int, y: int) -> int',
        parameters: ['x: int', 'y: int'],
    },
];

helper.verifySignature({
    s1: {
        signatures: simpleSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    s2: {
        signatures: simpleSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    s3: {
        signatures: simpleSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    s4: {
        signatures: simpleSignatures,
        activeParameter: 0,
        activeSignature: 0,
    },
    s5: {
        signatures: simpleSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    s6: {
        signatures: simpleSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    s7: {
        signatures: simpleSignatures,
        activeParameter: 1,
        activeSignature: 0,
    },
    sOutside: {
        noSig: true,
    },
    sNoCall: {
        noSig: true,
    },
});
