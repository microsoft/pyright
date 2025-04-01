# This sample tests the special-case handling of an overloaded __init__
# method where the "self" parameter is specialized to influence the
# type of the constructed object.

from typing import Any, Generic, Literal, Optional, Type, TypeVar, overload

_T = TypeVar("_T", bound=Optional[str])


class TextField(Generic[_T]):
    @overload
    def __init__(self: "TextField[str]", *, null: Literal[False] = ...) -> None: ...

    @overload
    def __init__(
        self: "TextField[Optional[str]]",
        *,
        null: Literal[True] = ...,
    ) -> None: ...

    @overload
    def __init__(self, *, null: bool = ...) -> None: ...

    def __init__(self, *, null: bool = ...) -> None: ...

    def __get__(self: "TextField[_T]", instance: Any, owner: Any) -> _T: ...


def foo(a: bool):
    reveal_type(TextField(), expected_text="TextField[str]")
    reveal_type(TextField(null=True), expected_text="TextField[str | None]")
    reveal_type(TextField(null=a), expected_text="TextField[Unknown]")


class Model: ...


_T1 = TypeVar("_T1", bound="Optional[Model]")
_T2 = TypeVar("_T2", bound="Optional[Model]")


class ForeignKey(Generic[_T1]):
    @overload
    def __init__(
        self: "ForeignKey[_T2]", to: Type[_T2], *, null: Literal[False] = ...
    ) -> None: ...

    @overload
    def __init__(
        self: "ForeignKey[Optional[_T2]]", to: Type[_T2], *, null: Literal[True]
    ) -> None: ...

    def __init__(self, to: Type[_T2], *, null: bool = False) -> None: ...


class Author(Model):
    pass


reveal_type(ForeignKey(Author, null=False), expected_text="ForeignKey[Author]")
reveal_type(ForeignKey(Author, null=True), expected_text="ForeignKey[Author | None]")


_T3 = TypeVar("_T3")
_T4 = TypeVar("_T4")
_S1 = TypeVar("_S1")
_S2 = TypeVar("_S2")


class Class1(Generic[_T3, _T4]):
    def __init__(self: "Class1[_S1, _S2]", value1: _S1, value2: _S2) -> None: ...


reveal_type(Class1(0, ""), expected_text="Class1[int, str]")


class Class2(Generic[_T3, _T4]):
    def __init__(self: "Class2[_S2, _S1]", value1: _S1, value2: _S2) -> None: ...


reveal_type(Class2(0, ""), expected_text="Class2[str, int]")


class Class3(Generic[_T3, _T4]):
    # This should generate an error because class-scoped TypeVars are not
    # allowed in the "self" type annotation for an __init__ method.
    def __init__(self: "Class3[_T3, _T4]", value1: _T3, value2: _T4) -> None: ...
