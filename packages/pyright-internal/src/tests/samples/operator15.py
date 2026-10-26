# This sample tests reflected operator priority for synthesized intersections.


def tuple_padding(padding: tuple[int, int]) -> bool:
    value = padding if isinstance(padding, int) else padding[0]
    reveal_type(2 * value, expected_text="int")
    reveal_type(value * 2, expected_text="tuple[int, ...] | int")
    return 0 <= 2 * value


def list_size(size: list[int], scale: int) -> int:
    value = size if isinstance(size, int) else size[0]
    reveal_type(scale * value, expected_text="int")
    reveal_type(value * scale, expected_text="list[int] | int")
    return int(scale * value / 2)


def union_padding(padding: int | tuple[int, int]) -> bool:
    value = padding if isinstance(padding, int) else padding[0]
    reveal_type(2 * value, expected_text="int")
    return 0 <= 2 * value


class Left:
    def __mul__(self, other: object) -> int:
        return 7


class ReflectedMixin:
    def __rmul__(self, other: Left) -> str:
        return "reflected"


class Right(ReflectedMixin, Left): ...


class Tag: ...


def genuine_subclass(left: Left, right: Right, tag: Tag):
    reveal_type(left * right, expected_text="str")
    if isinstance(right, Tag):
        reveal_type(left * right, expected_text="str")
    if isinstance(tag, Right):
        reveal_type(left * tag, expected_text="str")
