# This sample tests type inference for list expressions.

# pyright: strict, reportUnknownVariableType=false

from typing import (
    Any,
    Collection,
    Dict,
    Generic,
    List,
    Literal,
    Optional,
    Sequence,
    TypeVar,
)


v1 = [1, 2, 3]
t_v1: Literal["list[int]"] = reveal_type(v1)

v2 = [1, 3.4, "hi"]
t_v2: Literal["list[int | float | str]"] = reveal_type(v2)

v3 = []
t_v3: Literal["list[Unknown]"] = reveal_type(v3)

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
t_v10_1: Literal["list[Foo]"] = reveal_type(v10.baz)
v10.baz = [Foo()]
t_v10_2: Literal["list[Foo]"] = reveal_type(v10.baz)

v11: List[Any] = [["hi", ["hi"], [[{}]]]]
t_v11: Literal["list[Any]"] = reveal_type(v11)

v12: List[Optional[int]] = [None] * 3
t_v12: Literal["list[int | None]"] = reveal_type(v12)

v13: List[Optional[str]] = ["3", None] * 2
t_v13: Literal["list[str | None]"] = reveal_type(v13)

x1 = 3
v14: List[Optional[str]] = [None] * x1

x2 = [1, 2, 3]
v15: List[Optional[str]] = [None] * sum(x2)

v16: Dict[str, List[Optional[str]]] = {n: [None] * len(n) for n in ["a", "aa", "aaa"]}
