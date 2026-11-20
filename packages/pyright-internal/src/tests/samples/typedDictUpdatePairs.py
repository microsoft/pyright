from typing import Any, Generic, Literal, Never, ReadOnly, TypedDict, TypeVar, assert_type

T = TypeVar("T")


class Single(TypedDict, Generic[T]):
    alpha: T
    frozen: ReadOnly[int]


class Many(Single[T]):
    beta: list[T]
    gamma: tuple[T, str]
    impossible: Never
    dynamic: Any


def check(
    single: Single[int],
    many: Many[int],
    first: tuple[Literal["alpha"], int],
    second: tuple[Literal["beta"], list[int]],
    third: tuple[Literal["gamma"], tuple[int, str]],
    wrong: tuple[Literal["beta"], list[str]],
    frozen: tuple[Literal["frozen"], int],
) -> None:
    assert_type(single.update([first]), None)
    assert_type(many.update([first, second, third]), None)
    assert_type(many.update(beta=[1]), None)
    assert_type(many["beta"], list[int])
    assert_type(many["dynamic"], Any)
    many.update([wrong])
    many.update([frozen])
