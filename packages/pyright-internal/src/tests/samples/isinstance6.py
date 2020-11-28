# This sample tests isinstance and issubclass type narrowing
# based on cls and self parameters.

from typing import Literal


class Foo:
    @classmethod
    def bar(cls, other: type):
        if issubclass(other, cls):
            t1: Literal["Type[Foo]"] = reveal_type(other)

        if issubclass(other, (int, cls)):
            t2: Literal["Type[Foo] | Type[int]"] = reveal_type(other)

    def baz(self, other: object):
        if isinstance(other, self.__class__):
            t1: Literal["Foo"] = reveal_type(other)

        if isinstance(other, (int, self.__class__)):
            t2: Literal["Foo | int"] = reveal_type(other)
