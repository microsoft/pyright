# This sample tests the case where isinstance type narrowing is used
# with a protocol class that supports runtime checking.

# pyright: reportUnnecessaryIsInstance=true

from typing import Any, Iterable, Sized


def func1(v: Any) -> bool:
    if isinstance(v, Iterable):
        reveal_type(v, expected_text="Iterable[Unknown]")
        if isinstance(v, Sized):
            reveal_type(v, expected_text="<subclass of Iterable and Sized>")
            return True
    return False
