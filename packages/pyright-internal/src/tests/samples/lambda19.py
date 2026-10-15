# This sample tests that contextual lambda types account for optional defaults.

from typing import Literal, Protocol, assert_type


class Callback(Protocol):
    def __call__(self, *, value: int = 0) -> int: ...


# These should generate errors because calls without arguments return the wrong type.
wrong_keyword_only: Callback = lambda *, value="wrong": value
wrong_standard: Callback = lambda value="wrong": value
wrong_none: Callback = lambda *, value=None: value

compatible: Callback = lambda *, value=0: assert_type(value, int)
subtype_default: Callback = lambda *, value=True: assert_type(value, int)

broader_keyword_only: Callback = lambda *, value="wrong": (assert_type(value, int | str), 0)[1]
broader_standard: Callback = lambda value="wrong": (assert_type(value, int | str), 0)[1]
none_default: Callback = lambda *, value=None: (assert_type(value, int | None), 0)[1]

assert_type(broader_keyword_only(), Literal[0])
assert_type(broader_standard(), Literal[0])
assert_type(none_default(), Literal[0])


class ListCallback(Protocol):
    def __call__(self, *, values: list[int] = ...) -> list[int]: ...


empty_default: ListCallback = lambda *, values=[]: assert_type(values, list[int])
assert_type(empty_default(), list[int])
