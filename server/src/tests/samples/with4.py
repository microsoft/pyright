from typing import Optional

from typing_extensions import Literal


class DoesNotSuppress:
    def __enter__(self) -> int:
        ...

    def __exit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Optional[bool]:
        ...


class Suppresses1:
    def __enter__(self) -> int:
        ...

    def __exit__(self, exctype: object, excvalue: object, traceback: object) -> bool:
        ...


class Suppresses2:
    def __enter__(self) -> int:
        ...

    def __exit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Literal[True]:
        ...


def cond() -> bool:
    ...


def noop() -> None:
    ...


def test_suppress_1a() -> int:  # error missing return value
    with Suppresses1():
        return 3

    noop()


def test_suppress_1b() -> int:  # error missing return value
    with Suppresses1():
        if cond():
            return 3
        else:
            return 3
    noop()


def test_suppress_2() -> int:  # error missing return value
    with Suppresses2():
        return 3

    noop()


def test_mix() -> int:  # error missing return value
    with DoesNotSuppress(), Suppresses1(), DoesNotSuppress():
        return 3

    noop()
