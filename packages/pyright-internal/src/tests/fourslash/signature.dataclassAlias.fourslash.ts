/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Any, dataclass_transform
////
//// def model_field(*, kw_only: bool = False, alias: str = "") -> Any:
////     ...
////
//// @dataclass_transform(field_specifiers=(model_field,))
//// class ModelBase:
////     ...
////
//// class DC1(ModelBase):
////     before: int = model_field()
////     env: int = model_field(alias='Invalid Identifier')
////
//// DC1([|/*dc1*/|])
////
//// class DC2(ModelBase):
////     before: int = model_field(kw_only=True)
////     env: int = model_field(kw_only=True, alias='Invalid Identifier')
////
//// DC2([|/*dc2*/|])
////
//// class DC3(ModelBase):
////     before: int = model_field(kw_only=True)
////     env: int = model_field(kw_only=True, alias='Invalid Identifier')
////     after: int = model_field(kw_only=True)
////
//// DC3([|/*dc3*/|])
//// DC3(after=[|/*dc3_with_after*/|])

{
    helper.verifySignature('plaintext', {
        dc1: {
            signatures: [
                {
                    label: '(before: int, Invalid Identifier: int) -> DC1',
                    parameters: ['before: int', 'Invalid Identifier: int'],
                },
            ],
            activeParameters: [0],
        },
        dc2: {
            signatures: [
                {
                    label: '(*, before: int) -> DC2',
                    parameters: ['*', 'before: int'],
                },
            ],
            activeParameters: [undefined],
        },
        dc3: {
            signatures: [
                {
                    label: '(*, before: int, after: int) -> DC3',
                    parameters: ['*', 'before: int', 'after: int'],
                },
            ],
            activeParameters: [undefined],
        },
        dc3_with_after: {
            signatures: [
                {
                    label: '(*, before: int, after: int) -> DC3',
                    parameters: ['*', 'before: int', 'after: int'],
                },
            ],
            activeParameters: [2],
        },
    });
}
