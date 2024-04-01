# This sample tests type checking for list comprehensions.

from typing import Any, Generator, Iterable, Literal

a = [1, 2, 3, 4]


def func1() -> Generator[int, None, None]:
    b = (elem for elem in a)
    return b


def func2() -> list[int]:
    c = [elem for elem in a]
    return c


def func3() -> list[str]:
    c = [elem for elem in a]

    # This should generate an error because
    # c is a List[int], which doesn't match
    # the declared return type.
    return c

def func4():
    c = [(i for i in [1, 2, 3])]
    reveal_type(c, expected_text="list[Generator[int, None, None]]")


def generate():
    for i in range(2):
        yield i


# Verify that generate returns a Generator.
s = generate()
s.close()

# Verify that literals are handled correctly.
FooOrBar = Literal["foo", "bar"]


def to_list(values: Iterable[FooOrBar]) -> list[FooOrBar]:
    a = [value for value in values]
    reveal_type(a, expected_text="list[str]")

    b: list[FooOrBar] = [value for value in values]

    c = list(value for value in values)
    reveal_type(c, expected_text="list[str]")

    d: list[FooOrBar] = list(value for value in values)

    e = (value for value in values)
    reveal_type(e, expected_text="Generator[str, None, None]")

    f: Generator[FooOrBar, Any, Any] = (value for value in values)

    return [value for value in values]

x = 3
# This should generate a syntax error.
[x for in range(3)]

