# This sample tests the handling of Callable fields within a
# dataclass definition.

# pyright: strict

from dataclasses import dataclass
from typing import Any, Callable, TypeVar

CallableT = TypeVar("CallableT", bound=Callable[..., Any])


def decorate(arg: CallableT) -> CallableT:
    return arg


def f(s: str) -> int:
    return int(s)


@dataclass
class C:
    str_to_int: Callable[[str], int] = f


c = C()


reveal_type(c.str_to_int, expected_text="(str) -> int")

c.str_to_int = decorate(f)
