# This sample tests the special-case handling of an overloaded __init__
# method where the "self" parameter is specialized to influence the
# type of the constructed object.

from typing import Any, Generic, Literal, Optional, TypeVar, overload

_T = TypeVar("_T", bound=Optional[str])


class TextField(Generic[_T]):
    @overload
    def __init__(self: "TextField[str]", *, null: Literal[False] = ...) -> None:
        ...

    @overload
    def __init__(
        self: "TextField[Optional[str]]",
        *,
        null: Literal[True] = ...,
    ) -> None:
        ...

    @overload
    def __init__(self, *, null: bool = ...) -> None:
        ...

    def __init__(self, *, null: bool = ...) -> None:
        ...

    def __get__(self: "TextField[_T]", instance: Any, owner: Any) -> _T:
        ...


def foo(a: bool):
    t1: Literal["TextField[str]"] = reveal_type(TextField())
    t2: Literal["TextField[str | None]"] = reveal_type(TextField(null=True))
    t3: Literal["TextField[Unknown]"] = reveal_type(TextField(null=a))
