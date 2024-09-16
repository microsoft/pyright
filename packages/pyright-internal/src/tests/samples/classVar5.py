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
