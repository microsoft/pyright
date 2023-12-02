# This sample tests for the presence of an __exit__
# or __aexit__ method.


from contextlib import AbstractContextManager
from typing import Any, Literal, TypeVar

_T1 = TypeVar("_T1")


class Class2(object):
    def __enter__(self):
        return 1


class Class3(object):
    def __enter__(self: _T1) -> _T1:
        return self

    def __exit__(
        self,
        t: type | None = None,
        exc: BaseException | None = None,
        tb: Any | None = None,
    ) -> bool:
        return True


def requires_int(val: int):
    pass


def requires_class3(val: Class3):
    pass


def test1():
    a2 = Class2()
    a3 = Class3()

    # This should generate an error because
    # the __exit__ method is missing.
    with a2 as foo:
        requires_int(foo)

    # This should generate an error because
    # the __exit__ method is missing.
    with a2 as foo2, a3 as foo3:
        requires_int(foo2)
        requires_class3(foo3)


class Class4:
    async def __aenter__(self: _T1) -> _T1:
        return self


async def test2():
    a1 = Class4()

    # This should generate an error because __aexit__
    # needs to be used with async with.
    async with a1 as foo:
        pass


class Class5(AbstractContextManager[Any]):
    def __exit__(self, exc_type: Any, exc_value: Any, tb: Any) -> Literal[True]:
        return True


def test3(val: str | None):
    val = None
    with Class5():
        val = ""
        raise Exception

    reveal_type(val, expected_text="Literal[''] | None")
