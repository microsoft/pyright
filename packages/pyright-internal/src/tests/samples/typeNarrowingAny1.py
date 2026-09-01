# This sample tests the type analyzer's type narrowing logic for
# Any and Unknown types with "is None" checks.

# pyright: strict

from typing import Any, reveal_type


def test_any_narrowing(x: Any):
    if x is None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="Any")


def test_any_equality_narrowing(x: Any):
    # Test == None operator (narrowTypeForIsNone handles both is and ==)
    if x == None:
        reveal_type(x, expected_text="None")
    else:
        reveal_type(x, expected_text="Any")


def test_any_list_comprehension(xs: list[Any]):
    filtered = [x for x in xs if isinstance(x, str) or x is None]
    reveal_type(filtered, expected_text="list[str | None]")


def test_unknown_narrowing(x: int):
    # Create an Unknown type
    u = x.unknown_method()  # type: ignore
    reveal_type(u, expected_text="Unknown")
    
    if u is None:
        reveal_type(u, expected_text="None")
    else:
        reveal_type(u, expected_text="Unknown")
