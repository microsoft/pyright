# Tuple facts survive equivalent expressions and ordinary calls.
# pyright: reportUnknownVariableType=false
from typing import Literal, assert_type


def case_expressions():

    def conditional(flag: bool) -> bool:
        left = (1,) if flag else (2,)
        right = (3,)
        assert_type(left < right, bool)
        return left < right

    def direct_conditional(flag: bool) -> bool:
        return ((1,) if flag else (2,)) < (3,)

    def walrus() -> bool:
        assert_type((left := (1,)) < (2,), bool)
        assert_type(left, tuple[Literal[1]])
        return left < (2,)

    def concatenated() -> bool:
        left = (1,) + (2,)
        return left < (1, 3)

    def repeated() -> bool:
        left = (1,) * 2
        return left < (1, 3)

    def self_assignment() -> bool:
        left = (1,)
        left = left
        return left < (2,)

    def loop_assignment(count: int) -> bool:
        left: tuple[int, ...] = (1,)
        for _ in range(count):
            left = left + (1,)
        return left < (2,)

    def boolean_choice(flag: bool) -> bool:
        left = (() if flag else (1,)) or (2,)
        return left < (3,)

    def reflected_repetition() -> bool:
        left = 2 * (1,)
        return left < (1, 3)

    def later_assignment(value: tuple[int, ...]) -> bool:
        left: tuple[int, ...] = (1,)
        result = left < (2,)
        left = value
        return result

    def snapshot_before_rebinding(value: tuple[int, ...]) -> bool:
        left: tuple[int, ...] = (1,)
        saved = left
        left = value
        return saved < (2,)

    def conditional_rebinding() -> bool:
        left: tuple[int, ...] = (9,)
        return left < (2,) if (left := (1,)) else False

    assert conditional(True)
    assert conditional(False)
    assert direct_conditional(True)
    assert direct_conditional(False)
    assert walrus()
    assert concatenated()
    assert repeated()
    assert self_assignment()
    assert loop_assignment(0)
    assert loop_assignment(3)
    assert boolean_choice(True)
    assert boolean_choice(False)
    assert reflected_repetition()
    assert later_assignment((9,))
    assert snapshot_before_rebinding((9,))
    assert conditional_rebinding()

def make() -> tuple[Literal[1]]: return (1,)

def conditional(flag: bool) -> object:
    left = (1,) if flag else make()
    return left < (2,)
def walrus() -> object:
    return (left := make()) < (2,)
def concatenated() -> object:
    left = make() + (1,)
    return left < (2,)
def repeated() -> object:
    left = make() * 2
    return left < (2,)
def boolean_choice() -> object:
    left = make() or (1,)
    return left < (2,)
def mixed_prefix(flag: bool) -> object:
    left = (1, "text") if flag else (2, "text")
    return left < (1, 3)  # ERROR
def loop_rebinding() -> object:
    left: tuple[Literal[1]] = (1,)
    for _ in (0, 1):
        result = left < (2,)
        left = make()
    return result
def condition_rebinding() -> object:
    left: tuple[Literal[1]] = (1,)
    return left < (2,) if (left := make()) else False
def comprehension_rebinding() -> object:
    left: tuple[Literal[1]] = (1,)
    return [left < (2,) for _ in (0, 1) if (left := make())]
def nonlocal_rebinding() -> object:
    left: tuple[Literal[1]] = (1,)
    def change() -> None:
        nonlocal left
        left = make()
    change()
    return left < (2,)
global_left: tuple[Literal[1]] = (1,)
def change_global() -> None:
    global global_left
    global_left = make()
change_global()
global_result = global_left < (2,)
