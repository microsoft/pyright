# This sample tests the handling of metaclass magic methods for
# binary operators.

from typing import Literal


class MetaFoo(type):
    def __eq__(self, a: object) -> str:
        return "hi"

    def __add__(self, a: "Foo") -> int:
        return 0


class Foo(metaclass=MetaFoo):
    pass


def func1(a: Foo):
    t1: Literal["Type[Foo]"] = reveal_type(type(a))
    t2: Literal["Type[str]"] = reveal_type(type("string1"))

    t3: Literal["bool"] = reveal_type(type(a) == type("hi"))
    t4: Literal["bool"] = reveal_type(type("hi") == type("hi"))
    t5: Literal["bool"] = reveal_type(str != str)
    t6: Literal["str"] = reveal_type(Foo == type(a))
    t7: Literal["bool"] = reveal_type(Foo != type(a))

    # This should generate an error
    str + str

    t8: Literal["int"] = reveal_type(Foo + Foo)
