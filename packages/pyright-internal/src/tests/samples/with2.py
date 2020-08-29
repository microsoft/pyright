# This sample tests for the presence of an __exit__
# or __aexit__ method.


from typing import Any, Optional, TypeVar

_T1 = TypeVar("_T1")


class Class2(object):
    def __enter__(self):
        return 1


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


def test2():
    a1 = Class4()

    # This should generate an error because __aexit__
    # needs to be used with async with.
    async with a1 as foo:
        pass
