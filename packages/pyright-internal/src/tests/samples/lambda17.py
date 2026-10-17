# This sample tests contextual typing of reordered keyword-only parameters.

# pyright: strict

from typing import Protocol, assert_type


class SameTypeCallback(Protocol):
    def __call__(self, *, left: int, right: int) -> int: ...


same_type: SameTypeCallback = lambda right, left: assert_type(left, int) + assert_type(right, int)
reveal_type(same_type, expected_text="(right: int, left: int) -> int")
assert_type(same_type(left=1, right=2), int)


class MixedTypeCallback(Protocol):
    def __call__(self, *, left: int, right: str) -> str: ...


standard: MixedTypeCallback = lambda right, left: str(assert_type(left, int)) + assert_type(right, str)
reveal_type(standard, expected_text="(right: str, left: int) -> str")

keyword_only: MixedTypeCallback = lambda *, right, left: str(assert_type(left, int)) + assert_type(right, str)
reveal_type(keyword_only, expected_text="(*, right: str, left: int) -> str")


class VariadicCallback(Protocol):
    def __call__(self, prefix: bytes, *args: object, left: int, right: str) -> str: ...


variadic: VariadicCallback = lambda prefix, *args, right, left: (
    assert_type(prefix, bytes),
    assert_type(args, tuple[object, ...]),
    assert_type(left, int),
    assert_type(right, str),
)[3]


class OtherNameCallback(Protocol):
    def __call__(self, *args: object, other: int) -> int: ...


class ValueCallback(Protocol):
    def __call__(self, *args: object, value: str) -> str: ...


union_callback: OtherNameCallback | ValueCallback = lambda *args, value: assert_type(value, str)
reveal_type(union_callback, expected_text="(*args: object, value: str) -> str")
