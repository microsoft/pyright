# This sample tests the case where a member is accessed from a "type"
# instance or a Type[T].

# pyright: strict

from typing import TypeVar

Cls = TypeVar("Cls")


def func(cls: type[Cls]) -> list[type[Cls]]:
    return cls.__subclasses__()
