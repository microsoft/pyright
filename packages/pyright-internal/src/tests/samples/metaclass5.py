# This sample tests the handling of metaclass magic methods for
# binary operators.

from typing import Type


class MetaFoo(type):
    def __eq__(self, a: "Type[Foo]") -> str:
        return "hi"

    def __add__(self, a: "Type[Foo]") -> int:
        return 0


class Foo(metaclass=MetaFoo):
    pass


def func1(a: Foo):
    reveal_type(type(a), expected_text="Type[Foo]")
    reveal_type(type("string1"), expected_text="Type[str]")

    reveal_type(type(a) == type("hi"), expected_text="bool")
    reveal_type(type("hi") == type("hi"), expected_text="bool")
    reveal_type(str != str, expected_text="bool")
    reveal_type(Foo == type(a), expected_text="str")
    reveal_type(Foo != type(a), expected_text="bool")
    reveal_type(type(a) == Foo, expected_text="str")

    # This should generate an error
    str + str

    reveal_type(Foo + Foo, expected_text="int")
