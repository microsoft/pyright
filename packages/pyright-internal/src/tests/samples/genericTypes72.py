# This sample tests a special case of bidirectional type inference when
# the expected type is a union and the destination type is a union that
# contains Any and a TypeVar.


from typing import Any, Literal, TypeVar

_T = TypeVar("_T")


def getattr(__o: object, name: str, __default: _T) -> Any | _T:
    ...


x: Literal[1, 2, 3] = getattr(object(), "", 1)
