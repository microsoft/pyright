/// <reference path="typings/fourslash.d.ts" />

// @filename: posonly.py
//// class Test:
////     def method(self, /, a, b, *, c, d):
////         return
////
////     def normal(self, a, /, b, *, c, d):
////         return
////
//// Test().method([|/*m0*/|]
//// Test().method(0, [|/*m1*/|]
//// Test().method(0, 0, c=[|/*mc*/|]
//// Test().normal([|/*n0*/|]
//// Test().normal(0, [|/*n1*/|]
//// Test().normal(0, 0, c=[|/*nc*/|]

{
    const methodSignatures = [
        {
            label: '(a: Unknown, b: Unknown, *, c: Unknown, d: Unknown) -> None',
            parameters: ['a: Unknown', 'b: Unknown', '*', 'c: Unknown', 'd: Unknown'],
        },
    ];

    const normalSignatures = [
        {
            label: '(a: Unknown, /, b: Unknown, *, c: Unknown, d: Unknown) -> None',
            parameters: ['a: Unknown', '/', 'b: Unknown', '*', 'c: Unknown', 'd: Unknown'],
        },
    ];

    helper.verifySignature('plaintext', {
        m0: {
            signatures: methodSignatures,
            activeParameters: [0],
        },
        m1: {
            signatures: methodSignatures,
            activeParameters: [1],
        },
        mc: {
            signatures: methodSignatures,
            activeParameters: [3],
        },
        n0: {
            signatures: normalSignatures,
            activeParameters: [0],
        },
        n1: {
            signatures: normalSignatures,
            activeParameters: [2],
        },
        nc: {
            signatures: normalSignatures,
            activeParameters: [4],
        },
    });
}
