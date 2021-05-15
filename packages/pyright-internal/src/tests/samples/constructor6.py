# This sample tests the special-case handling of an overloaded __init__
# method where the "self" parameter is specialized to influence the
# type of the constructed object.

from typing import Any, Generic, Literal, Optional, Type, TypeVar, overload

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


class Model:
    ...


_T1 = TypeVar("_T1", bound="Optional[Model]")
_T2 = TypeVar("_T2", bound="Optional[Model]")


class ForeignKey(Generic[_T1]):
    @overload
    def __init__(
        self: "ForeignKey[_T2]", to: Type[_T2], *, null: Literal[False] = ...
    ) -> None:
        ...

    @overload
    def __init__(
        self: "ForeignKey[Optional[_T2]]", to: Type[_T2], *, null: Literal[True]
    ) -> None:
        ...

    def __init__(self, to: Type[_T2], *, null: bool) -> None:
        ...


class Author(Model):
    pass


t1: Literal["ForeignKey[Author]"] = reveal_type(ForeignKey(Author, null=False))
t2: Literal["ForeignKey[Author | None]"] = reveal_type(ForeignKey(Author, null=True))
