/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import TypedDict, Unpack
////
//// class User(TypedDict):
////     name: str
////     """The fullname of the User"""
////
////     age: int
////     """The age of the User, will not be over 200"""
////
//// def foo(**user: Unpack[User]) -> None:
////     ...
////
//// foo(name='Robert', [|/*marker1*/age|]=100)
//// foo(name='Robert', [|/*marker2*/age|]=)
//// foo([|/*marker3*/name|]='Robert')

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) age: int\n```\n---\nThe age of the User, will not be over 200',
    marker2: '```python\n(variable) age: int\n```\n---\nThe age of the User, will not be over 200',
    marker3: '```python\n(variable) name: str\n```\n---\nThe fullname of the User',
});
