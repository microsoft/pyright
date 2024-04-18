# This sample tests inheritance rules for closed TypedDicts.

from typing import Any, Never, NotRequired, Required, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class Parent1(TypedDict, closed=True):
    __extra_items__: int | None


class Child1_1(Parent1, closed=True):
    __extra_items__: int | None


class Child1_2(Parent1, closed=True):
    # This should generate an error because of a type mismatch.
    __extra_items__: int


class ParentClosed1(TypedDict, closed=True):
    a: int


class ChildClosed1_1(ParentClosed1, closed=True):
    __extra_items__: Never


# This should generate an error.
class ChildClosed1_2(ParentClosed1):
    b: str


# This should generate an error because __extra_items__ is incompatible type.
class ChildClosed1_3(ParentClosed1, closed=True):
    __extra_items__: int


class ParentClosed2(TypedDict, closed=True):
    a: int
    __extra_items__: Never


# This should generate an error.
class ChildClosed2(ParentClosed2):
    b: str


class ParentClosed3(TypedDict, closed=True):
    a: int
    __extra_items__: int | str


class ChildClosed3_1(ParentClosed3):
    b: NotRequired[int | str]


class ChildClosed3_2(ParentClosed3):
    b: NotRequired[Any]


# This should generate an error.
class ChildClosed3_3(ParentClosed3):
    b: NotRequired[int]


# This should generate an error.
class ChildClosed3_4(ParentClosed3):
    b: int | str


class ParentClosed4(TypedDict, closed=True):
    a: int
    __extra_items__: ReadOnly[int | str]


class ChildClosed4_1(ParentClosed4):
    b: int


class ChildClosed4_2(ParentClosed4):
    b: Any


class ChildClosed4_3(ParentClosed4):
    b: Required[int]


class ChildClosed4_4(ParentClosed4):
    b: NotRequired[int]


class ChildClosed4_5(ParentClosed4):
    b: ReadOnly[int | str]


class ChildClosed4_6(ParentClosed4, closed=True):
    __extra_items__: int | str


# This should generate an error.
class ChildClosed4_7(ParentClosed4):
    b: list[str]


class MovieBase(TypedDict, closed=True):
    name: str
    __extra_items__: int | None


# This should generate an error.
class AdaptedMovie(MovieBase):
    adapted_from_novel: bool


# This should generate an error.
class MovieRequiredYear(MovieBase):
    year: int | None


# This should generate an error.
class MovieNotRequiredYear(MovieBase):
    year: NotRequired[int]


class MovieWithYear(MovieBase):
    year: NotRequired[int | None]
