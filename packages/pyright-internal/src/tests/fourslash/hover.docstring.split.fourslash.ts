/// <reference path="fourslash.ts" />

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
//// [|/*marker1*/func|]()
//// [|/*marker2*/func2|]()
//// [|/*marker3*/func3|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(function) func() -> None\n```\n---\nThis docstring is split.',
    marker2: '```python\n(function) func2() -> None\n```',
    marker3: '```python\n(function) func3() -> None\n```',
});
