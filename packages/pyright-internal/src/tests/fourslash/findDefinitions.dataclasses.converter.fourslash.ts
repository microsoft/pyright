/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Any, Callable, dataclass_transform
////
////
//// def converter_simple(s: str) -> int:
////     ...
////
////
//// def model_field(*, converter: Callable[..., Any]) -> Any:
////     ...
////
////
//// @dataclass_transform(field_specifiers=(model_field,))
//// class ModelBase:
////     ...
////
////
//// class A(ModelBase):
////     [|converted_attribute|]: int = model_field(converter=converter_simple)
////
////
//// a = A("1")
//// print(a.[|/*marker*/converted_attribute|])

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions({
        marker: {
            definitions: rangeMap
                .get('converted_attribute')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
    });
}
