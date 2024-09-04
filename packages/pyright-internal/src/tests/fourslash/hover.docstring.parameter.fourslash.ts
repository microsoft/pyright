/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def foo1([|/*marker1*/bar|]: str) -> None:
////     """
////     Foo1 does something
////
////     @param bar: The bar is in town
////     """
////     baz = [|/*marker2*/bar|]
////     ...
////
//// def foo2([|/*marker3*/bar|]: str) -> None:
////     """
////     Foo2 does something
////
////     :param bar: The bar is in town
////     """
////     baz = [|/*marker4*/bar|]
////     ...
////
//// def foo3([|/*marker5*/bar|]: str, [|/*marker6*/bar2|]: str) -> None:
////     """
////     Foo3 does something
////
////     Args:
////         bar: The bar is in town
////         bar2 The bar is 2 far
////     """
////     baz = [|/*marker7*/bar|]
////     [|/*marker8*/bar|] = "reassign"
////     ...
////
//// def foo4([|/*marker9*/bar|]: str, [|/*marker10*/bar2|]: str) -> None:
////     """
////     Foo4 does something
////
////     Args:
////         bar (str): The bar is in town
////         bar2 str: The bar is 2 far
////     """
////     baz = [|/*marker11*/bar|]
////     ...

helper.verifyHover('markdown', {
    marker1: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker2: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker3: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker4: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker5: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker6: '```python\n(parameter) bar2: str\n```',
    marker7: '```python\n(parameter) bar: str\n```\nbar: The bar is in town',
    marker8: "```python\n(parameter) bar: Literal['reassign']\n```\nbar: The bar is in town",
    marker9: '```python\n(parameter) bar: str\n```\nbar (str): The bar is in town',
    marker10: '```python\n(parameter) bar2: str\n```',
    marker11: '```python\n(parameter) bar: str\n```\nbar (str): The bar is in town',
});
