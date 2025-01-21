# This sample tests the logic for narrowing a metaclass using an
# issubclass call.

from abc import ABC, ABCMeta
from typing import Any, ClassVar, Iterable
from typing_extensions import reveal_type  # pyright: ignore[reportMissingModuleSource]


class Meta1(ABCMeta):
    pass


class Parent1(ABC, metaclass=Meta1):
    pass


class Child1(Parent1):
    x: ClassVar[tuple[int, int]] = (0, 1)


def func1(m: Meta1) -> None:
    if issubclass(m, Parent1):
        reveal_type(m, expected_text="type[Parent1]")
    else:
        reveal_type(m, expected_text="Meta1")


def func2(m: Meta1) -> None:
    if issubclass(m, Child1):
        reveal_type(m, expected_text="type[Child1]")
    else:
        reveal_type(m, expected_text="Meta1")


def func3(m: ABCMeta) -> None:
    if issubclass(m, Child1):
        reveal_type(m, expected_text="type[Child1]")
    else:
        reveal_type(m, expected_text="ABCMeta")


def func4(m: ABCMeta) -> None:
    if issubclass(m, (Parent1, Child1, int)):
        reveal_type(m, expected_text="type[Parent1] | type[Child1]")
    else:
        reveal_type(m, expected_text="ABCMeta")


def func5(m: Meta1) -> None:
    if issubclass(m, (Parent1, Child1)):
        reveal_type(m, expected_text="type[Parent1] | type[Child1]")
    else:
        reveal_type(m, expected_text="Meta1")


def func6(m: Meta1, x: type[Any]) -> None:
    if issubclass(m, x):
        reveal_type(m, expected_text="Meta1")
    else:
        reveal_type(m, expected_text="Meta1")


def func7(m: Meta1, x: type[Parent1] | type[Child1]) -> None:
    if issubclass(m, x):
        reveal_type(m, expected_text="type[Parent1] | type[Child1]")
    else:
        reveal_type(m, expected_text="Meta1")


def func8(cls: type):
    if isinstance(cls, Meta1):
        reveal_type(cls, expected_text="Meta1")
    else:
        reveal_type(cls, expected_text="type")


class Meta2(type):
    pass


class Class2(metaclass=Meta2):
    pass


def func9(v: type[Class2] | Iterable[type[Class2]]):
    if isinstance(v, Meta2):
        reveal_type(v, expected_text="type[Class2]")
    else:
        reveal_type(v, expected_text="Iterable[type[Class2]]")
