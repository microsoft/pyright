# This sample tests that `_` in any scope can be re-assigned with any
# type including functions/methods and classes.

from typing import cast

# Global scope.
if True:
    _ = cast("int", ...)
    reveal_type(_, expected_text="int")

    _ = cast("float", ...)
    reveal_type(_, expected_text="float")

    _ = cast("str", ...)
    reveal_type(_, expected_text="str")

    def _() -> None: ...
    reveal_type(_, expected_text="() -> None")

    class _:
        ...
    reveal_type(_, expected_text="Type[_]")

# Function scope.
def f() -> None:
    _ = cast("int", ...)
    reveal_type(_, expected_text="int")

    _ = cast("float", ...)
    reveal_type(_, expected_text="float")

    _ = cast("str", ...)
    reveal_type(_, expected_text="str")

    def _() -> None: ...
    reveal_type(_, expected_text="() -> None")

    class _:
        ...
    reveal_type(_, expected_text="Type[_]")

# Class scope.
class C:
    _ = cast("int", ...)
    reveal_type(_, expected_text="int")

    _ = cast("float", ...)
    reveal_type(_, expected_text="float")

    _ = cast("str", ...)
    reveal_type(_, expected_text="str")

    def _(self) -> None: ...
    reveal_type(_, expected_text="(self: Self@C) -> None")

    @staticmethod
    def _() -> None: ...
    reveal_type(_, expected_text="() -> None")

    @classmethod
    def _(cls) -> None: ...
    reveal_type(_, expected_text="(cls: Type[Self@C]) -> None")

    class _:
        ...
    reveal_type(_, expected_text="Type[_]")
