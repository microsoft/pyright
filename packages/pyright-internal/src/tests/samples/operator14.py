# A nonreturning forward operation is not a NotImplemented decline.

from types import NotImplementedType
from typing import Never, NoReturn


class Base:
    def __add__(self, other: object) -> Never:
        raise RuntimeError()

    def __radd__(self, other: object) -> object:
        return 0


class Declines(Base):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


class Partial(Base):
    def __radd__(self, other: object) -> int | NotImplementedType:
        return 1 if bool() else NotImplemented


class ReflectedNever(Base):
    def __radd__(self, other: object) -> Never:
        raise RuntimeError()


class Inherited(Base):
    pass


def exact_check(base: Base, child: Declines) -> list[Never]:
    return [base + child]


def reveal_check(base: Base, child: Declines):
    reveal_type([base + child], expected_text="list[Never]")


def controls(base: Base, child: Inherited):
    reveal_type([base.__add__(child)], expected_text="list[Never]")
    reveal_type([base + child], expected_text="list[Never]")


def partial_check(base: Base, child: Partial):
    reveal_type([base + child], expected_text="list[int]")


def reflected_check(base: Base, child: ReflectedNever):
    reveal_type([base + child], expected_text="list[Never]")


class NoReturnBase:
    def __add__(self, other: object) -> NoReturn:
        raise RuntimeError()

    def __radd__(self, other: object) -> object:
        return 0


class NoReturnChild(NoReturnBase):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


def noreturn_check(base: NoReturnBase, child: NoReturnChild) -> list[NoReturn]:
    return [base + child]
