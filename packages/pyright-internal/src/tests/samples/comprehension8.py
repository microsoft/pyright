# This sample tests the evaluation of a list comprehension where
# there are interdependencies between some of the variables.

# pyright: strict


class ClassA:
    input: str
    output: str


def func1(foo: ClassA):
    foo.output = "".join(
        stripped for line in foo.input.splitlines() if (stripped := line.strip())
    )
