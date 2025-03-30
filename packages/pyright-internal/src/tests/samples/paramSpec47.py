# This sample tests the handling of recursive uses of ParamSpec.

from typing import Any, Callable, ParamSpec


P = ParamSpec("P")


def func1(f: Callable[P, Any], *args: P.args, **kwargs: P.kwargs) -> str: ...


def func2(a: int) -> int:
    return 42


v2 = func1(func2, 42)
reveal_type(v2, expected_text="str")

# This should generate an error.
func1(func2, "42")

v3 = func1(func1, func2, 42)
reveal_type(v3, expected_text="str")

# This should generate an error.
func1(func1, func2, "42")

# This should generate an error.
func1(func1)

v4 = func1(func1, lambda: None)
reveal_type(v4, expected_text="str")
