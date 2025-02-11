/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// async def [|/*marker1*/test|]():
////    pass
////
//// y = [|/*marker2*/test|]
helper.verifyHover('markdown', {
    marker1: '```python\n(function) async def test() -> None\n```',
    marker2: '```python\n(function) def test() -> CoroutineType[Any, Any, None]\n```',
});
