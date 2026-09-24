# This sample tests solving a TypeVarTuple from heterogeneous arguments.

from typing import TypeVarTuple

Ts = TypeVarTuple("Ts")


def same_tuple(arg1: tuple[*Ts], arg2: tuple[*Ts]) -> tuple[*Ts]:
    raise NotImplementedError


same_tuple((0,), ("",))


def check_same_tuple(x: int, y: str):
    result = same_tuple((x,), (y,))
    reveal_type(result, expected_text="tuple[int | str]")


class Base:
    pass


class Sub(Base):
    pass


def check_subtypes(base: Base, sub: Sub):
    result = same_tuple((base, sub), (sub, base))
    reveal_type(result, expected_text="tuple[Base, Base]")


def same_args(*args: tuple[*Ts]) -> None:
    pass


same_args((0,), ("",))
