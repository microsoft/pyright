from typing import Literal, LiteralString, assert_type, overload


class ReflectedCompare:
    def __gt__(self, other: tuple[Literal[1]]) -> str:
        return "gt"

    def __ge__(self, other: tuple[Literal[1]]) -> str:
        return "ge"

    def __lt__(self, other: tuple[Literal[1]]) -> str:
        return "lt"

    def __le__(self, other: tuple[Literal[1]]) -> str:
        return "le"


def test_reflected(value: ReflectedCompare) -> None:
    assert_type((1,) < value, str)
    assert_type((1,) <= value, str)
    assert_type((1,) > value, str)
    assert_type((1,) >= value, str)


class DirectCompare:
    def __lt__(self, other: tuple[Literal[1]]) -> str:
        return "lt"

    def __le__(self, other: tuple[Literal[1]]) -> str:
        return "le"

    def __gt__(self, other: tuple[Literal[1]]) -> str:
        return "gt"

    def __ge__(self, other: tuple[Literal[1]]) -> str:
        return "ge"


def test_direct(value: DirectCompare) -> None:
    assert_type(value < (1,), str)
    assert_type(value <= (1,), str)
    assert_type(value > (1,), str)
    assert_type(value >= (1,), str)


class OverloadedCompare:
    @overload
    def __gt__(self, other: tuple[Literal[1]]) -> int: ...
    @overload
    def __gt__(self, other: tuple[int]) -> int | str: ...

    def __gt__(self, other: tuple[int]) -> int | str:
        return 1 if other == (1,) else "other"


def test_overload(value: OverloadedCompare) -> None:
    assert_type((1,) < value, int)


class LiteralCompare:
    def __gt__(self, other: tuple[Literal["text"], Literal[b"bytes"], Literal[True]]) -> str:
        return "ok"


class LiteralStringCompare:
    def __gt__(self, other: tuple[LiteralString]) -> str:
        return "ok"


def test_other_literals(value: LiteralCompare, text_value: LiteralStringCompare) -> None:
    assert_type(("text", b"bytes", True) < value, str)
    assert_type(("text",) < text_value, str)


def test_inferred_union(flag: bool, other: bool) -> bool:
    a: tuple[int, ...] = (1, 2) if flag else (3, 4)
    b: tuple[int, ...] = (5, 6) if other else (7, 8)
    return a < b


def test_explicit_union(
    a: tuple[Literal[1]] | tuple[Literal[2]],
    b: tuple[Literal[3]] | tuple[Literal[4]],
) -> bool:
    return a < b
