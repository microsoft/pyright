/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import mylib
////
//// mylib.[|/*marker1*/dontwork|]
//// mylib.[|/*marker2*/works|]

// @filename: mylib/__init__.pyi
//// from typing import overload
////
//// class RandomState:
////     @overload
////     def dontwork(self, x:int) -> None: ...
////     @overload
////     def dontwork(self, x:float) -> None: ...
////     def works(self) -> None: ...
////
//// _rand = RandomState
////
//// dontwork = _rand.dontwork
//// works = _rand.works

// @filename: mylib/__init__.py
//// from typing import Union, overload
////
//// class RandomState:
////     @overload
////     def dontwork(self, x:int) -> None: ...
////     def dontwork(self, x:Union[int, float]) -> None:
////         'dontwork docstring'
////         ...
////     def works(self) -> None:
////         'works docstring'
////         ...

helper.verifyHover('markdown', {
    marker1:
        '```python\n(variable)\ndef dontwork(self: _rand, x: int) -> None: ...\ndef dontwork(self: _rand, x: float) -> None: ...\n```\n---\ndontwork docstring',
    marker2: '```python\n(variable) def works(self: _rand) -> None\n```\n---\nworks docstring',
});
