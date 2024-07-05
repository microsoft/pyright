# This sample tests the case where an unpacked tuple argument in a call
# expression is matched to an `*args` parameter that has a declared type
# that includes an unpacked TypeVarTuple.

from typing_extensions import TypeVarTuple  # pyright: ignore[reportMissingModuleSource]

Ts = TypeVarTuple("Ts")


def call0(*args: *Ts) -> tuple[*Ts]: ...


def call1(*args: *tuple[int, *Ts]) -> tuple[*Ts]: ...


def call2(*args: *tuple[*Ts, float]) -> tuple[*Ts]: ...


def call3(*args: *tuple[int, *Ts, float]) -> tuple[*Ts]: ...


def call4(*args: *tuple[*tuple[int, *tuple[*Ts], float]]) -> tuple[*Ts]: ...


def func1(*args: *tuple[int, str]):
    reveal_type(call0(*args), expected_text="tuple[int, str]")


def func2(*args: *tuple[int, ...]):
    reveal_type(call0(*args), expected_text="tuple[int, ...]")


def func3(*args: *tuple[int, *tuple[str, ...], float]):
    reveal_type(call0(*args), expected_text="tuple[int, *tuple[str, ...], float]")


def func4(*args: *Ts) -> tuple[*Ts]:
    call0(*args)
    return args


def func5(x: int, y: str, z: float):
    v1 = call1(*(x, y, z))
    reveal_type(v1, expected_text="tuple[str, float]")

    v2 = call2(*(x, y, z))
    reveal_type(v2, expected_text="tuple[int, str]")

    v3 = call3(*(x, y, z))
    reveal_type(v3, expected_text="tuple[str]")

    v4 = call4(*(x, *(y, z)))
    reveal_type(v4, expected_text="tuple[str]")


def func6(*args: *tuple[int, *tuple[None, ...], float]):
    reveal_type(call2(*args), expected_text="tuple[int, *tuple[None, ...]]")
