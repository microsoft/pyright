from typing import Literal


t1: tuple[int, ...] = (1, 2, 3)
t2: tuple[int, ...] = (1, 2, 4)

reveal_type(t1, expected_text="tuple[int, ...]")
reveal_type(t2, expected_text="tuple[int, ...]")

_ = t1 >= t2


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
