# This sample tests various forms of the 'with' statement.

from typing import Any, Generic, Optional, TypeVar, Self

_T1 = TypeVar("_T1")


class Class1(object):
    def __exit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


class Class2(object):
    def __enter__(self):
        return 1

    def __exit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


class Class3(object):
    def __enter__(self: _T1) -> _T1:
        return self

    def __exit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


def requires_int(val: int):
    pass


def requires_class3(val: Class3):
    pass


def test1():
    a1 = Class1()

    # This should generate an error because Class1
    # does not implement an __enter__
    with a1 as foo:
        pass

    a2 = Class2()
    with a2 as foo:
        requires_int(foo)

    a3 = Class3()
    with a3 as foo:
        # This should generate an error because foo
        # should be of type Class3.
        requires_int(foo)

        requires_class3(foo)

    with a2 as foo2, a3 as foo3:
        requires_int(foo2)
        requires_class3(foo3)


class Class4:
    async def __aenter__(self: _T1) -> _T1:
        return self

    async def __aexit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


async def test2():
    a1 = Class4()

    # This should generate two errors because Class4 does not
    # implement __enter__ or __exit__.
    with a1 as foo:
        pass

    async with a1 as foo:
        pass


class Class5(Generic[_T1]):
    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None


class Class6(Class5[int]): ...


async def do():
    async with Class6() as f:
        reveal_type(f, expected_text="Class6")
