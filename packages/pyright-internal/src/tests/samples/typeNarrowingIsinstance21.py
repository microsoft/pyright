# This sample tests the case where the filter type is a class object.

# pyright: reportMissingModuleSource=false

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
