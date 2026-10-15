from typing import Literal


t1: tuple[int, ...] = (1, 2, 3)
t2: tuple[int, ...] = (1, 2, 4)

reveal_type(t1, expected_text="tuple[Literal[1], Literal[2], Literal[3]]")
reveal_type(t2, expected_text="tuple[Literal[1], Literal[2], Literal[4]]")

_ = t1 >= t2

a: tuple[int | str, ...] = (1,)
b: tuple[int | str, ...] = ("a",)
_ = a >= b  # This should generate an error.
_ = a > b  # This should generate an error.
_ = a <= b  # This should generate an error.
_ = a < b  # This should generate an error.


def accepts_two(value: tuple[int, int]) -> int:
    return value[0] + value[1]


fixed: tuple[int, ...] = (1, 2)
_ = accepts_two(fixed)

empty: tuple[int, ...] = ()
_ = empty[0]  # This should generate an error.

single: tuple[int, ...] = (1,)
_ = single[2]  # This should generate an error.

partially_unbounded: tuple[str, *tuple[int, ...]] = ("a", 1)
_ = partially_unbounded[1] + 1

objects: tuple[object, ...] = (1, 2)
_ = objects[0] + 1

optional: tuple[int | None, ...] = (1, 2)
_ = optional[0] + 1


def consume(flag: bool) -> None:
    value: tuple[Literal["number"], int, *tuple[int, ...]] | tuple[Literal["text"], str, *tuple[str, ...]]
    if flag:
        value = ("number", 1)
    else:
        value = ("text", "hello")

    if value[0] == "number":
        print(value[1] + 1)
    else:
        print(value[1].upper())
