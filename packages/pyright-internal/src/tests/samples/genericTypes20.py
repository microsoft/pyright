# This sample tests the "pseudo-generic class" functionality,
# where a class is made into a generic class in cases where
# it has no annotated constructor parameters.

# We use "strict" here because we want to ensure that there are
# no "unknown" types remaining in this file.
# pyright: strict, reportUnknownParameterType=false, reportMissingParameterType=false

from logging import Handler, NOTSET


class Foo(Handler):
    def __init__(self, a, b="hello", level=NOTSET):
        super().__init__(level)
        self._foo_a = a
        self._foo_b = b

    @property
    def value_a(self):
        return self._foo_a

    @property
    def value_b(self):
        return self._foo_b


def test_function(a: int, b: str):
    return


foo1 = Foo(27)
int_value_1 = foo1.value_a
str_value_1 = foo1.value_b
test_function(int_value_1, str_value_1)


foo2 = Foo("hello", 27)
str_value_2 = foo2.value_a
int_value_2 = foo2.value_b
test_function(int_value_2, str_value_2)

# This should generate an error because a pseudo-generic
# class is not actually generic.
foo3: Foo[int, str, int]
