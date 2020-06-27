# This sample tests for context manager that might suppress exceptions.

from contextlib import contextmanager, suppress
from typing import Any, Iterator, Optional

from typing_extensions import Literal


class DoesNotSuppress1:
    def __enter__(self) -> int:
        ...

    def __exit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Optional[bool]:
        ...


class DoesNotSuppress2:
    def __enter__(self) -> int:
        ...

    def __exit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Literal[False]:
        ...


class DoesNotSuppress3:
    def __enter__(self) -> int:
        ...

    def __exit__(self, exctype: object, excvalue: object, traceback: object) -> Any:
        ...


class DoesNotSuppress4:
    def __enter__(self) -> int:
        ...

    def __exit__(self, exctype: object, excvalue: object, traceback: object) -> None:
        ...


@contextmanager
def simple() -> Iterator[int]:
    yield 3


def cond() -> bool:
    ...


def test_no_suppress_1a() -> int:
    with DoesNotSuppress1():
        return 3

    return "str"  # not an error because it's unreachable


def test_no_suppress_1b() -> int:
    with DoesNotSuppress1():
        if cond():
            return 3
        else:
            return 3

    return "str"  # not an error because it's unreachable


def test_no_suppress_2() -> int:
    with DoesNotSuppress2():
        return 3

    return "str"  # not an error because it's unreachable


def test_no_suppress_3() -> int:
    with DoesNotSuppress3():
        return 3

    return "str"  # not an error because it's unreachable


def test_no_suppress_4() -> int:
    with DoesNotSuppress4():
        return 3

    return "str"  # not an error because it's unreachable


def test_no_suppress_5() -> int:
    with simple():
        return 3

    return "str"  # not an error because it's unreachable


def test_contextlib_suppress():
    with suppress(KeyError):
        raise KeyError

    return 5


def require_int(val: int):
    pass


require_int(test_contextlib_suppress())
