# This sample tests contextual typing of expanded TypedDict keys and residual kwargs.

from typing import Any, Protocol, TypedDict, Unpack, assert_type


class Options(TypedDict):
    value: int


class Callback(Protocol):
    def __call__(self, **kwargs: Unpack[Options]) -> int: ...


callback: Callback = lambda *, value, **extra: (
    assert_type(value, int),
    assert_type(extra, dict[str, Any]),
    value,
)[2]
assert_type(callback(value=1), int)


def ordinary(*, value: int, **extra: object) -> int:
    return value


control: Callback = ordinary


class MixedOptions(TypedDict):
    left: int
    right: str


class MixedCallback(Protocol):
    def __call__(self, **kwargs: Unpack[MixedOptions]) -> str: ...


mixed: MixedCallback = lambda *, right, left, **options: (
    assert_type(left, int),
    assert_type(right, str),
    assert_type(options, dict[str, Any]),
    right,
)[3]


class TypedOptions(TypedDict, extra_items=str):
    value: int


class TypedCallback(Protocol):
    def __call__(self, **kwargs: Unpack[TypedOptions]) -> int: ...


typed: TypedCallback = lambda *, value, **options: (
    assert_type(value, int),
    assert_type(options, dict[str, str]),
    value,
)[2]


class ClosedOptions(TypedDict, closed=True):
    value: int


class ClosedCallback(Protocol):
    def __call__(self, **kwargs: Unpack[ClosedOptions]) -> int: ...


closed: ClosedCallback = lambda *, value: assert_type(value, int)

# This should generate an error because the required keyword name differs.
wrong_name: ClosedCallback = lambda *, other: other
