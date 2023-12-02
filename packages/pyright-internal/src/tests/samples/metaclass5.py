# This sample tests the handling of metaclass magic methods for
# binary operators.

# pyright: reportIncompatibleMethodOverride=false


class MetaA(type):
    def __eq__(self, a: "type[ClassA]") -> str:
        return "hi"

    def __add__(self, a: "type[ClassA]") -> int:
        return 0


class ClassA(metaclass=MetaA):
    pass


def func1(a: ClassA):
    reveal_type(type(a), expected_text="type[ClassA]")
    reveal_type(type("string1"), expected_text="type[str]")

    reveal_type(type(a) == type("hi"), expected_text="bool")
    reveal_type(type("hi") == type("hi"), expected_text="bool")
    reveal_type(str != str, expected_text="bool")
    reveal_type(ClassA == type(a), expected_text="str")
    reveal_type(ClassA != type(a), expected_text="bool")
    reveal_type(type(a) == ClassA, expected_text="str")

    # This should generate an error
    x = str + str

    reveal_type(ClassA + ClassA, expected_text="int")
