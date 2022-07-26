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


foo1 = Foo(27)
reveal_type(foo1.value_a, expected_text="int")
reveal_type(foo1.value_b, expected_text="str")


foo2 = Foo("hello", "27")
reveal_type(foo2.value_a, expected_text="str")
reveal_type(foo2.value_b, expected_text="str")

# This should generate an error because a pseudo-generic
# class is not actually generic.
foo3: Foo[int, str, int]
