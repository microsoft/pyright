/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def func():
////     '''This docstring ''' '''is split.'''
////     pass
////
//// def func2():
////     f'''This docstring ''' '''is split.'''
////     pass
////
//// def func3():
////     '''This docstring ''' f'''is split.'''
////     pass
////
//// def func4(a:int, b:int, c:int):
////     """
////     Args:
////         a (int): description
////         b (int|bool): 한국어
////         c (int): description
////     """
////
//// [|/*marker1*/func|]()
//// [|/*marker2*/func2|]()
//// [|/*marker3*/func3|]()
//// [|/*marker4*/func4|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(function) def func() -> None\n```\n---\nThis docstring is split.',
    marker2: '```python\n(function) def func2() -> None\n```',
    marker3: '```python\n(function) def func3() -> None\n```',
    marker4:
        '```python\n(function) def func4(a: int, b: int, c: int) -> None\n```\n---\nArgs:  \n&nbsp;&nbsp;&nbsp;&nbsp;a (int): description  \n&nbsp;&nbsp;&nbsp;&nbsp;b (int|bool): 한국어  \n&nbsp;&nbsp;&nbsp;&nbsp;c (int): description',
});
