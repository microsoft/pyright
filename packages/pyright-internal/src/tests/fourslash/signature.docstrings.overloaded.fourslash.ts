/// <reference path="typings/fourslash.d.ts" />

// @filename: docstrings.pyi
//// from typing import overload
////
//// @overload
//// def repeat() -> str:
////     """This is a docstring on the first overload."""
//// @overload
//// def repeat(x: int) -> int: ...
////
//// repeat([|/*marker1*/|])

{
    helper.verifySignature('plaintext', {
        marker1: {
            signatures: [
                {
                    label: '() -> str',
                    parameters: [],
                    documentation: 'This is a docstring on the first overload.',
                },
                {
                    label: '(x: int) -> int',
                    parameters: ['x: int'],
                    documentation: 'This is a docstring on the first overload.',
                },
            ],
            activeParameters: [undefined, 0],
        },
    });

    helper.verifySignature('markdown', {
        marker1: {
            signatures: [
                {
                    label: '() -> str',
                    parameters: [],
                    documentation: 'This is a docstring on the first overload.',
                },
                {
                    label: '(x: int) -> int',
                    parameters: ['x: int'],
                    documentation: 'This is a docstring on the first overload.',
                },
            ],
            activeParameters: [undefined, 0],
        },
    });
}
