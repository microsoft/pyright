/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import overload
////
//// class NewDocs:
////     @overload
////     def __init__(self, x: int) -> None: ...
////     @overload
////     def __init__(self, x: str) -> None: ...
////     def __init__(self, x: int | str) -> None: pass
////
////     @overload
////     def __new__(cls, x: int) -> "NewDocs":
////         """new integer docs"""
////     @overload
////     def __new__(cls, x: str) -> "NewDocs":
////         """new string docs"""
////     def __new__(cls, x: int | str) -> "NewDocs":
////         return super().__new__(cls)
////
//// NewDocs([|/*marker1*/|]1)

helper.verifySignature('markdown', {
    marker1: {
        signatures: [
            {
                label: '(x: int) -> NewDocs',
                parameters: ['x: int'],
                documentation: 'new integer docs',
            },
            {
                label: '(x: str) -> NewDocs',
                parameters: ['x: str'],
                documentation: undefined,
            },
        ],
        activeParameters: [0, 0],
    },
});
