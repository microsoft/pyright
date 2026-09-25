# This sample tests that a class pattern whose class may be a subclass of
# the named class (such as a value of type type[X]) does not eliminate the
# subject type when the match fails.

# pyright: reportUnreachable=true


class Example:
    __match_args__ = ("value",)

    def __init__(self, value: str) -> None:
        self.value = value


def func1(subclass: type[Example]) -> None:
    match Example("a"):
        case subclass(value):
            reveal_type(value, expected_text="str")
        case anything:
            reveal_type(anything, expected_text="Example")


def func2(subclass: type[Example], subject: Example) -> None:
    match subject:
        case subclass():
            reveal_type(subject, expected_text="Example")
        case _:
            reveal_type(subject, expected_text="Example")


from typing import final


@final
class Leaf:
    pass


def final_pattern(value: Leaf | str, pattern: type[Leaf]) -> str:
    match value:
        case pattern():
            return "leaf"
        case _:
            reveal_type(value, expected_text="str")
            return value


def bool_pattern(value: bool | str, pattern: type[bool]) -> str:
    match value:
        case pattern():
            return "bool"
        case _:
            reveal_type(value, expected_text="str")
            return value
