# This sample tests the case where a super() call is used with a class
# whose constructor uses a default argument value with a parameter
# whose type is a specialized TypeVar.

from typing import Generic, TypeVar

_T = TypeVar("_T")


class Foo(Generic[_T]):
    def __init__(self, x: _T = 1) -> None: ...


class Bar(Foo[int]): ...


class Baz(Bar):
    def __init__(self) -> None:
        super().__init__()


class Baz2(Bar):
    def __init__(self) -> None:
        super().__init__(x=1)


class Bar2(Foo[int]):
    def __init__(self) -> None:
        super().__init__()


class Bar3(Foo[int]):
    def __init__(self) -> None:
        super().__init__(x=1)
