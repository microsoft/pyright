# This sample tests a special case of bidirectional type inference when
# the expected type is a union and the destination type is a union that
# contains Any and a TypeVar.


from typing import Any, Literal, TypeVar

_T = TypeVar("_T")


def func1(__o: object, __name: str, __default: _T) -> Any | _T: ...


x: Literal[1, 2, 3] = func1(object(), "", 1)


def func2(a: _T) -> bool | _T: ...


y = func2(None)
if y is not True:
    z = y or func2(False)
