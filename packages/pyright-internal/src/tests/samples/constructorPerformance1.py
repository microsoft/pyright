# This sample exercises nested constructors and loop-carried values when
# constructors inherit the default object.__new__ implementation.

from dataclasses import dataclass
from typing import Self


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
