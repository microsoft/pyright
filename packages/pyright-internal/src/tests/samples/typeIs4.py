# This sample tests the case where IsType uses a type[T].

# pyright: reportMissingModuleSource=false

from inspect import isclass
from typing import Any, TypeVar

from typing_extensions import TypeIs

T = TypeVar("T")


class Foo:
    ...


def is_foo(obj: object) -> TypeIs[type[Foo]]:
    return isclass(obj) and issubclass(obj, Foo)


def test1(obj: type[T]) -> T:
    if is_foo(obj):
        reveal_type(obj, expected_text="type[Foo]*")
    else:
        reveal_type(obj, expected_text="type[object]*")

    return obj()


def test2(obj: dict[str, int] | type[Foo]):
    if is_foo(obj):
        reveal_type(obj, expected_text="type[Foo]")
    else:
        reveal_type(obj, expected_text="dict[str, int]")


def test3(obj: Any):
    if is_foo(obj):
        reveal_type(obj, expected_text="type[Foo]")
    else:
        reveal_type(obj, expected_text="Any")
