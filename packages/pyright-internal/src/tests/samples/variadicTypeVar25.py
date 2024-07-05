# This sample tests the case where a TypeVarTuple is used in a
# nested callable type.

from typing import Callable, TypeVarTuple

Ts = TypeVarTuple("Ts")


def func1(g: Callable[[Callable[[*Ts], None]], None]) -> tuple[*Ts]: ...


def func2(cb: Callable[[bytes, int], None]) -> None: ...


reveal_type(func1(func2), expected_text="tuple[bytes, int]")
