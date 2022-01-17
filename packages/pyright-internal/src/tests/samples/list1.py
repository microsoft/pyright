# This sample tests type inference for list expressions.

# pyright: strict, reportUnknownVariableType=false

from typing import (
    Any,
    Collection,
    Dict,
    Generic,
    List,
    Optional,
    Sequence,
    TypeVar,
)


v1 = [1, 2, 3]
reveal_type(v1, expected_text="list[int]")

v2 = [1, 3.4, "hi"]
reveal_type(v2, expected_text="list[int | float | str]")

v3 = []
reveal_type(v3, expected_text="list[Unknown]")

v4: List[object] = []

v5: object = []

v6: Sequence[float] = [3, 4, 5]

v7: Collection[object] = [[]]


_T = TypeVar("_T")


class Baz(Generic[_T]):
    def __get__(self, instance: Any, owner: Any) -> _T:
        ...

    def __set__(self, instance: Any, value: _T) -> None:
        ...


class Foo:
    ...


class Bar:
    baz: Baz[list[Foo]]


v10 = Bar()
reveal_type(v10.baz, expected_text="list[Foo]")
v10.baz = [Foo()]
reveal_type(v10.baz, expected_text="list[Foo]")

v11: List[Any] = [["hi", ["hi"], [[{}]]]]
reveal_type(v11, expected_text="list[Any]")

v12: List[Optional[int]] = [None] * 3
reveal_type(v12, expected_text="list[int | None]")

v13: List[Optional[str]] = ["3", None] * 2
reveal_type(v13, expected_text="list[str | None]")

x1 = 3
v14: List[Optional[str]] = [None] * x1

x2 = [1, 2, 3]
v15: List[Optional[str]] = [None] * sum(x2)

v16: Dict[str, List[Optional[str]]] = {n: [None] * len(n) for n in ["a", "aa", "aaa"]}
