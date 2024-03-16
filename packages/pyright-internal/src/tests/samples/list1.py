# This sample tests type inference for list expressions.

# pyright: strict, reportUnknownVariableType=false

from typing import Any, Collection, Generic, Literal, MutableSequence, Sequence, TypeVar


v1 = [1, 2, 3]
reveal_type(v1, expected_text="list[int]")

v2 = [1, 3.4, "hi"]
reveal_type(v2, expected_text="list[int | float | str]")

v3 = []
reveal_type(v3, expected_text="list[Unknown]")

v4: list[object] = []

v5: object = []

v6: Sequence[float] = [3, 4, 5]

v7: Collection[object] = [[]]


_T = TypeVar("_T")


class Baz(Generic[_T]):
    def __get__(self, instance: Any, owner: Any) -> _T: ...

    def __set__(self, instance: Any, value: _T) -> None: ...


class Foo: ...


class Bar:
    baz: Baz[list[Foo]]


v10 = Bar()
reveal_type(v10.baz, expected_text="list[Foo]")
v10.baz = [Foo()]
reveal_type(v10.baz, expected_text="list[Foo]")

v11: list[Any] = [["hi", ["hi"], [[{}]]]]
reveal_type(v11, expected_text="list[Any]")

v12: list[int | None] = [None] * 3
reveal_type(v12, expected_text="list[int | None]")

v13: list[str | None] = ["3", None] * 2
reveal_type(v13, expected_text="list[str | None]")

x1 = 3
v14: list[str | None] = [None] * x1

x2 = [1, 2, 3]
v15: list[str | None] = [None] * sum(x2)

v16: dict[str, list[str | None]] = {n: [None] * len(n) for n in ["a", "aa", "aaa"]}


ScalarKeysT = TypeVar("ScalarKeysT", bound=Literal["name", "country"])


def func1(by: list[ScalarKeysT]) -> ScalarKeysT: ...


reveal_type(func1(["country"]), expected_type="Literal['country']")
reveal_type(func1(["name"]), expected_type="Literal['name']")
reveal_type(func1(["name", "country"]), expected_type="Literal['name', 'country']")

# This should generate an error.
func1(["id"])


def func2(thing: str | list[str | int] | list[list[str | int]]): ...


func2("")
func2(["", 0])
func2([["", 0], ["", 0]])
func2([[""]])


def func3(value: _T) -> list[_T]:
    to_add = [value, str(value)]
    # This should generate an error.
    return to_add


def func4(value: _T) -> list[_T]:
    # This should generate an error.
    return [value, str(value)]


def func5():
    v1: Sequence[int | str] = [1]
    reveal_type(v1, expected_text="list[int]")

    v2: MutableSequence[int | str] = [1]
    reveal_type(v2, expected_text="list[int | str]")
