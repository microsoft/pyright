# This sample tests the synthesized update method for TypedDict classes.

from typing import NotRequired, Required, TypedDict


class TD1(TypedDict):
    a: Required[int]
    b: NotRequired[str]


class TD2(TD1):
    c: Required[int]


td1: TD1 = {"a": 3}

reveal_type(
    td1.update,
    expected_text="Overload[(__m: Iterable[tuple[Literal['a'], int] | tuple[Literal['b'], str]], /) -> None, (__m: Partial[TD1], /) -> None, (*, a: int = ..., b: str = ...) -> None]",
)

td1.update({})
td1.update({"b": ""})

td2: TD2 = {"a": 0, "c": 3}

reveal_type(
    td2.update,
    expected_text="Overload[(__m: Iterable[tuple[Literal['a'], int] | tuple[Literal['b'], str] | tuple[Literal['c'], int]], /) -> None, (__m: Partial[TD2], /) -> None, (*, a: int = ..., b: str = ..., c: int = ...) -> None]",
)

# This should generate an error because "c" within TD1 may be incompatible with "int".
# A second error is generated to indicate that no overloads are compatible.
td2.update(td1)


class TD3(TypedDict):
    a: NotRequired[str]


td3: TD3 = {}
reveal_type(
    td3.update,
    expected_text="Overload[(__m: Iterable[tuple[Literal['a'], str]], /) -> None, (__m: Partial[TD3], /) -> None, (*, a: str = ...) -> None]",
)
