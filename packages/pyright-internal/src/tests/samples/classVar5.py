# This sample tests the access of a ClassVar that uses Self in its
# declaration.

# It's not clear whether this should be permitted. Arguably, it's not
# type safe, but mypy admits it. This should be clarified in the typing
# spec.

from typing import ClassVar, Self


class Parent:
    x: ClassVar[dict[str, Self]] = {}

    @classmethod
    def __init_subclass__(cls):
        cls.x = {}


class Baz:
    values: ClassVar[list[Self]]


Baz.values = []
Baz.values = [Baz()]

# This should generate an error.
Baz.values = [1]


class Child(Baz):
    pass


Child.values = []
Child.values = [Child()]

# This should generate an error.
Child.values = [Baz()]
