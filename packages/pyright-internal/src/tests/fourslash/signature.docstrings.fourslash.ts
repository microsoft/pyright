/// <reference path="typings/fourslash.d.ts" />

// @filename: docstrings.py
//// from typing import overload
////
//// def repeat(a: str, b: int) -> str:
////    """Repeat the string ``a`` ``b`` times.
////
////    >>> repeat('foo', 3)
////    'foofoofoo'
////    """
////
////    return a * b
////
//// repeat([|/*marker1*/|])

{
    helper.verifySignature('plaintext', {
        marker1: {
            signatures: [
                {
                    label: '(a: str, b: int) -> str',
                    parameters: ['a: str', 'b: int'],
                    documentation: "Repeat the string ``a`` ``b`` times.\n\n>>> repeat('foo', 3)\n'foofoofoo'",
                },
            ],
            activeParameters: [0],
        },
    });

    helper.verifySignature('markdown', {
        marker1: {
            signatures: [
                {
                    label: '(a: str, b: int) -> str',
                    parameters: ['a: str', 'b: int'],
                    documentation: "Repeat the string `a` `b` times.\n\n```\n>>> repeat('foo', 3)\n'foofoofoo'\n```",
                },
            ],
            activeParameters: [0],
        },
    });
}
