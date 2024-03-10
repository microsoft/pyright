# This sample tests type narrowing in a loop.

from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]
from collections.abc import Generator


class A:
    parent: Self | None


class B: ...


def foo(v: A | B | None) -> Generator[A, None, None]:
    reveal_type(v)
    if not isinstance(v, B):
        reveal_type(v, expected_text="A | None")
        while v is not None:
            reveal_type(v, expected_text="A")
            yield v
            v = v.parent
            reveal_type(v, expected_text="A | None")
