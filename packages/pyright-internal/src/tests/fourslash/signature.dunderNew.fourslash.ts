/// <reference path="typings/fourslash.d.ts" />

// @filename: dunderNew.py
////
//// class Foo:
////     def __new__(cls, x:int, y:int):
////         return super().__new__(cls)

////
//// Foo([|/*s1*/|]

{
    const simpleSignatures = [
        {
            label: '(x: int, y: int) -> Foo',
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
