# This sample tests control flow and generic recovery during contextual inference.

from typing import NoReturn, TypeVar


class Helper:
    def fail(self):
        raise ValueError("always raises")

    def fail_declared(self) -> NoReturn:
        raise ValueError("always raises")

    def implicit(self) -> int:
        self.fail()
        return None

    def declared(self) -> int:
        self.fail_declared()
        return None

    def exception_path(self) -> int:
        try:
            result = 1
        except Exception:
            self.fail()
        return result


reveal_type(Helper().fail, expected_text="() -> NoReturn")


def reverse_or_default(values, default):
    if getattr(values, "__reversed__", None):
        return next(reversed(values))
    return default


def enumerate_input(values):
    pool = enumerate(values)
    reveal_type(reverse_or_default(pool, (1, None)), expected_text="Unknown | tuple[Literal[1], None]")
    first, second = reverse_or_default(pool, (1, None))
    return first, second


def known_inputs():
    reveal_type(reverse_or_default([1, 2], (1, None)), expected_text="int | tuple[Literal[1], None]")
    reveal_type(
        reverse_or_default(enumerate([1, 2]), (1, None)), expected_text="Unknown | tuple[Literal[1], None]"
    )
    reveal_type(reverse_or_default(["a", "b"], (1, None)), expected_text="str | tuple[Literal[1], None]")
    reveal_type(reverse_or_default([1, 2], (1, None)), expected_text="int | tuple[Literal[1], None]")


T = TypeVar("T")


def generic_input(values: list[T], default: T):
    reveal_type(reverse_or_default(values, default), expected_text="T@generic_input")


def invalid_constructor_input(values: enumerate[int]):
    # This should generate two errors because enumerate is not reversible.
    result = next(reversed(values))
    reveal_type(result, expected_text="Unknown")
