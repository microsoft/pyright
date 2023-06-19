# This sample tests the handling of invariant union type compatibility
# checks that include a callable with a type variable.

from typing import Callable, TypeVar


T = TypeVar("T")


def str2int(a: str) -> int:
    return int(a)


def int2str(b: int) -> str:
    return str(b)


def func1(cb: Callable[[str], T], val: list[Callable[[T], str] | None]):
    pass


func1(str2int, [int2str])
func1(str2int, [None])
func1(str2int, [])
func1(str2int, [int2str, None])
