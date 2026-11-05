# This sample exercises nested constructors and loop-carried values when
# constructors inherit the default object.__new__ implementation.

from dataclasses import dataclass
from typing import Self
from warnings import deprecated


class Chain: ...


class Value: ...


@dataclass
class Inner:
    val: Value | None


@dataclass
class Outer:
    inner: Inner


def step(op: Outer, chain: Chain) -> tuple[Value, Chain]: ...


def run(chain: Chain) -> Value | None:
    val: Value | None = None
    for _ in range(3):
        val, chain = step(Outer(Inner(val)), chain)
        val, chain = step(Outer(Inner(val)), chain)
        val, chain = step(Outer(Inner(val)), chain)
        val, chain = step(Outer(Inner(val)), chain)
    return val


Outer(Inner(1))  # E


class ExplicitNew:
    def __new__(cls, value: int) -> Self: ...

    def __init__(self, value: str) -> None: ...


ExplicitNew('value')  # E


class VariadicNew:
    def __new__(cls, *args: int, **kwargs: str) -> Self:
        for value in args:
            value.bit_length()
        return super().__new__(cls)

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass


VariadicNew(1, key="value")
VariadicNew("bad")  # E
VariadicNew(key=1)  # E


class InheritedVariadicNew(VariadicNew):
    pass


InheritedVariadicNew("bad")  # E


class DeprecatedNew:
    @deprecated("Use replacement instead", category=None)
    def __new__(cls, *args: object, **kwargs: object) -> Self:
        return super().__new__(cls)

    def __init__(self) -> None:
        pass


DeprecatedNew()  # E
