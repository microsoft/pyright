# This sample tests the handling of type annotations within a
# python source file (as opposed to a stub file).

from typing import Any, Callable, TypeVar, Union
import uuid
from datetime import datetime


class ClassA:
    # This should generate an error because ClassA
    # is not yet defined at the time it's used.
    def func0(self) -> ClassA | None:
        return None


class ClassB(ClassA):
    def func1(self) -> ClassA:
        return ClassA()

    # This should generate an error because ClassC
    # is a forward reference, which is not allowed
    # in a python source file.
    def func2(self) -> ClassC | None:
        return None

    def func3(self) -> "ClassC | None":
        return None

    def func4(self) -> "ClassC | None":
        return None

    def func5(self) -> "int | None":
        return None


class ClassC:
    pass


def func10():
    pass


# This should generate an error because function calls
# are not allowed within a type annotation.
x1: func10()

x2: """
    Union[
        int,
        str
    ]
"""


class ClassD:
    ClassA: "ClassA"

    # This should generate an error because ClassF refers
    # to itself, and there is no ClassF declared at the module
    # level. It should also generate a second error because
    # ClassF is a variable and can't be used as an annotation.
    ClassF: "ClassF"

    str: "str"

    def int(self): ...

    foo: "int"

    # This should generate an error because it refers to the local
    # "int" symbol rather than the builtins "int".
    bar: int


# This should generate an error because modules are not allowed in
# type annotations.
x3: typing


class ClassG:
    uuid = uuid.uuid4()


class ClassH:
    # This should generate an error because uuid refers to the local
    # symbol in this case, which is a circular reference.
    uuid: uuid.UUID = uuid.uuid4()


def func11():
    for t in [str, float]:
        # This should generate an error because t is not a valid annotation.
        def f(x: str) -> t:
            return t(x) + 1

        f("")


def func12(x: type[int]):
    # These should not generate an error because they are used
    # in a location that is not considered a type annotation, so the
    # normal annotation limitations do not apply here.
    print(Union[x, x])
    print(x | None)


# This should generate an error because x4 isn't defined.
x4: int = x4


class ClassJ:
    datetime: datetime


T = TypeVar("T")


x5: type[int] = int

# This should generate an error because variables are not allowed
# in a type annotation.
x6: x5 = 1

# This should generate an error because variables are not allowed
# in a type annotation.
x7: list[x5] = [1]

# This should generate an error because a Callable isn't allowed
# in a "type".
x8: type[Callable]

# This should generate an error because a Callable isn't allowed
# in a "type".
x9: type[func11]

# This should generate an error because a Callable isn't allowed
# in a "type".
x10: type[Callable[..., Any]]

# This should generate an error because raw strings aren't allowed.
x11: r"int"

# This should generate an error because bytes strings aren't allowed.
x12: b"int"

# This should generate an error because format strings aren't allowed.
x13: f"int"


class A:
    def method1(self):
        # This should result in an error.
        x: self

    @classmethod
    def method2(cls):
        # This should result in an error.
        x: cls
