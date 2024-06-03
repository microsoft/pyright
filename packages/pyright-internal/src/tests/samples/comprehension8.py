# This sample tests the evaluation of a list comprehension where
# there are interdependencies between some of the variables.

# pyright: strict


class ClassA:
    input: str
    output: str


def func1(a: ClassA, x: str):
    a.output = x.join(
        stripped for line in a.input.splitlines() if (stripped := line.strip())
    )
