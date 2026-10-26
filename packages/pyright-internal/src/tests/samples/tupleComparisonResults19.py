from typing import assert_type


class TextOrder:
    def __lt__(self, other: object) -> str:
        return "text"

    def __le__(self, other: object) -> str:
        return "text"

    def __gt__(self, other: object) -> str:
        return "text"

    def __ge__(self, other: object) -> str:
        return "text"


type Cell[T] = tuple[T | TextOrder]


def accepts_text(value: str | bool) -> None:
    pass


def needs_bool(value: bool) -> None:
    pass


def compare(left: tuple[Cell[int], Cell[int]], right: tuple[Cell[int], Cell[int]]) -> None:
    match left:
        case ((int(),), (TextOrder(),)):
            match right:
                case ((int(),), (TextOrder(),)):
                    assert_type(left, tuple[tuple[int], tuple[TextOrder]])
                    assert_type(right, tuple[tuple[int], tuple[TextOrder]])
                    assert_type(left < right, str | bool)
                    assert_type(left <= right, str | bool)
                    assert_type(left > right, str | bool)
                    assert_type(left >= right, str | bool)
                    accepts_text(left < right)
                    accepts_text(left <= right)
                    accepts_text(left > right)
                    accepts_text(left >= right)

                    # Alias metadata is shared, but the narrowed shapes differ.
                    needs_bool(left < right)
                    needs_bool(left <= right)
                    needs_bool(left > right)
                    needs_bool(left >= right)
                case _:
                    pass
        case _:
            pass
