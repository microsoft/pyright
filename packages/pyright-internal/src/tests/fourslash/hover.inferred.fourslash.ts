/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import third_party_module  # type: ignore
////
//// def return_one():
////     one = third_party_module.one()
////     if one is None:
////         return
////     return one
////
//// def return_two() -> int:
////     [|on/*marker1*/e|]: int | None = return_one()
////     assert one is not None
////     two = [|on/*marker2*/e|] + 1
////     return two
////
//// [|tw/*marker3*/o|] = return_two()
helper.verifyHover('markdown', {
    marker1: '```python\n(variable) one: Unknown | None\n```',
    marker2: '```python\n(variable) one: Unknown\n```',
    marker3: '```python\n(variable) two: int\n```',
});
