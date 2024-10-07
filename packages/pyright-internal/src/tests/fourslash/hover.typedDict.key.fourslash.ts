/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import TypedDict
////
//// class User(TypedDict):
////     name: str
////     """The fullname of the User"""
////
////     age: int
////     """The age of the User, will not be over 200"""
////
////     views: float
////
//// user: User = {[|/*marker1*/'name'|]: 'Robert'}
////
//// def foo(user: User) -> None:
////     ...
////
//// foo({[|/*marker2*/'name'|]})
//// foo({[|/*marker3*/'views'|]})
//// foo({[|/*marker4*/'points'|]})
//// foo({'name': 'Robert', [|/*marker5*/'age'|]})
//// foo({'name': 'Robert', [|/*marker6*/'age'|]: 100})
//// foo({'name': [|/*marker7*/'Robert'|], 'age': 100})
//// foo({'name': [|/*marker8*/'name'|]})
////
//// class Post(TypedDict):
////     title: str
////     age: int
////     """The age of the Post"""
////
//// def bar(item: Post | User) -> None:
////     ...
////
//// bar({[|/*marker9*/'title'|]})
//// bar({[|/*marker10*/'age'|]})

helper.verifyHover('markdown', {
    marker1: '```python\n(key) name: str\n```\n---\nThe fullname of the User',
    marker2: '```python\n(key) name: str\n```\n---\nThe fullname of the User',
    marker3: '```python\n(key) views: float\n```',
    marker4: null,
    marker5: '```python\n(key) age: int\n```\n---\nThe age of the User, will not be over 200',
    marker6: '```python\n(key) age: int\n```\n---\nThe age of the User, will not be over 200',
    marker7: null,
    marker8: null,
    marker9: '```python\n(key) title: str\n```',
    marker10:
        '```python\n(key) age: int\n```\n---\nThe age of the Post\n\n---\n```python\n(key) age: int\n```\n---\nThe age of the User, will not be over 200',
});
