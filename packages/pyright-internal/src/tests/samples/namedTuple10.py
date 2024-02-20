# This sample tests that a subclass of a named tuple doesn't override
# a read-only entry in the parent class.

from typing import NamedTuple


class Point(NamedTuple):
    x: int
    y: int

    def f(self):
        pass


class BadPointWithName(Point):
    name: str

    # This should generate an error.
    x: int

    def f(self):
        pass
