# This sample tests the handling of type annotations within a
# python source file (as opposed to a stub file).

from typing import Optional, Union


class ClassA:
    # This should generate an error because ClassA
    # is not yet defined at the time it's used.
    def func0(self) -> Optional[ClassA]:
        return None


class ClassB(ClassA):
    def func1(self) -> ClassA:
        return ClassA()

    # This should generate an error because ClassC
    # is a forward reference, which is not allowed
    # in a python source file.
    def func2(self) -> Optional[ClassC]:
        return None

    def func3(self) -> "Optional[ClassC]":
        return None

    def func4(self) -> Optional["ClassC"]:
        return None

    # This should generate an error for Python versions 3.9
    # and earlier.
    def func5(self) -> "Optional"[int]:
        return None


class ClassC:
    pass


def func10():
    pass


# This should generate an error because function calls
# are not allowed within a type annotation.
x: func10()

y: """
    Union[
        int,
        str
    ]
"""


class ClassD:
    ClassA: "ClassA"

    # This should generate an error because ClassF refers
    # to itself, and there is no ClassF declared at the module
    # level.
    ClassF: "ClassF"

    str: "str"

    def int(self):
        ...

    foo: "int"

    # This should generate an error because it refers to the local
    # "int" symbol rather than the builtins "int".
    bar: int


# This should generate an error because modules are not allowed in
# type annotations.
z: typing
