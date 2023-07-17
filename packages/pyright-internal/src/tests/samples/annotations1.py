# This sample tests the handling of type annotations within a
# python source file (as opposed to a stub file).

from typing import TypeVar, Union
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
    # level. It should also generate a second error because
    # ClassF is a variable and can't be used as an annotation.
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


# This should generate an error because foo isn't defined.
foo: int = foo


class ClassJ:
    datetime: datetime


T = TypeVar("T")


def func13(x: type[T]) -> type[T]:
    return x


v1 = func13(int)

# This should generate an error because variables are not allowed
# in a type annotation.
v2: v1 = 1

# This should generate an error because variables are not allowed
# in a type annotation.
v3: list[v1] = [1]
