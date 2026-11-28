from collections.abc import Callable, Sequence, Set
from typing import assert_type, overload


@overload
def choose(callback: Callable[..., int]) -> int: ...


@overload
def choose(callback: Callable[[str], object]) -> object: ...


def choose(callback: Callable[..., object]) -> object:
    return 1


assert_type(choose(lambda unused: 1), int)


@overload
def choose_list(callbacks: Sequence[Callable[..., int]]) -> int: ...


@overload
def choose_list(callbacks: Sequence[Callable[[str], object]]) -> object: ...


def choose_list(callbacks: object) -> object:
    return 1


assert_type(choose_list([lambda unused: 1]), int)


@overload
def choose_set(callbacks: Set[Callable[..., int]]) -> int: ...


@overload
def choose_set(callbacks: Set[Callable[[str], object]]) -> object: ...


def choose_set(callbacks: object) -> object:
    return 1


assert_type(choose_set({lambda unused: 1}), int)


@overload
def choose_nested(callbacks: Sequence[str] | Sequence[Sequence[Callable[..., int]]]) -> int: ...


@overload
def choose_nested(callbacks: Sequence[Sequence[Callable[[str], object]]]) -> object: ...


def choose_nested(callbacks: object) -> object:
    return 1


assert_type(choose_nested([[lambda unused: 1]]), int)


@overload
def choose_unknown_list(value: Sequence[str] | Sequence[Sequence[str]]) -> str: ...


@overload
def choose_unknown_list(value: Sequence[Sequence[object]]) -> object: ...


def choose_unknown_list(value: object) -> object:
    return "result"


@overload
def choose_deep_unknown_list(value: Sequence[str] | Sequence[Sequence[Sequence[str]]]) -> str: ...


@overload
def choose_deep_unknown_list(value: Sequence[Sequence[Sequence[object]]]) -> object: ...


def choose_deep_unknown_list(value: object) -> object:
    return "result"


def check_unknown_list(row: list[str] | list, value) -> None:
    assert_type(choose_unknown_list([row, []]), str)
    assert_type(choose_unknown_list([[], row]), str)
    assert_type(choose_unknown_list([[value]]), str)
    assert_type(choose_unknown_list([[x for x in row]]), str)
    assert_type(choose_unknown_list([[*row]]), str)
    assert_type(choose_deep_unknown_list([[[value]]]), str)
