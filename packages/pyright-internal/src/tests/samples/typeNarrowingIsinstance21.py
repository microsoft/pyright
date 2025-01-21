# This sample tests the case where the filter type is a class object.

# pyright: reportMissingModuleSource=false

from typing import Any
from typing_extensions import TypeIs


class Sentinel:
    pass


def is_sentinel(value: object) -> TypeIs[type[Sentinel]]: ...


def _(a: dict[str, int] | type[Sentinel]):
    if is_sentinel(a):
        reveal_type(a, expected_text="type[Sentinel]")
    else:
        reveal_type(a, expected_text="dict[str, int]")


def is_str_type(typ: object) -> TypeIs[type[str]]:
    return typ is str


def test_typevar[T](typ: type[T], val: T) -> None:
    if is_str_type(typ):
        reveal_type(typ, expected_text="type[str]*")


def func1(v: Sentinel | type[Sentinel]):
    if isinstance(v, Sentinel):
        reveal_type(v, expected_text="Sentinel")
    else:
        reveal_type(v, expected_text="type[Sentinel]")


class A:
    pass


class B:
    pass


def guard3(t: type[Any]) -> TypeIs[type[A]]:
    return True


def func3(t: type[B]):
    if guard3(t):
        reveal_type(t, expected_text="type[<subclass of B and A>]")
    else:
        reveal_type(t, expected_text="type[B]")


def guard4(t: Any) -> TypeIs[type[A]]:
    return True


def func4(t: B):
    if guard4(t):
        reveal_type(t, expected_text="<subclass of B and type[A]>")
    else:
        reveal_type(t, expected_text="B")


class CParent: ...


class CChild(CParent): ...


def func5(val: CChild, t: type[CParent]):
    if not isinstance(val, t):
        reveal_type(val, expected_text="CChild")
