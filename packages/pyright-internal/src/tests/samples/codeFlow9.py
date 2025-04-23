# This sample tests the case where a comprehension-scoped variable
# shadows a variable of the same name in an outer scope and is
# narrowed within the comprehension.

def func1(m: list[str | int]) -> None:
    print(
        [
            reveal_type(value, expected_text="str")
            for value in m
            if isinstance(value, str)
        ]
    )

    reveal_type(value, expected_text="() -> None")
    value()


def value() -> None:
    pass
