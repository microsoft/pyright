# This sample tests the evaluation of a list comprehension where
# there are interdependencies between some of the variables.

# pyright: strict


class Foo:
    input: str
    output: str


def minify1(foo: Foo):
    foo.output = "".join(
        stripped for line in foo.input.splitlines() if (stripped := line.strip())
    )
