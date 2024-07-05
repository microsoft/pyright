# This sample tests the logic for validating that an explicit
# "self" or "cls" parameter type is honored when binding the
# method to an object or class.

from typing import Protocol, TypeVar


class HasItemProtocol1(Protocol):
    item: int


class Mixin1:
    def do_stuff(self: HasItemProtocol1):
        pass


class A1(Mixin1):
    item = 1


class B1(Mixin1):
    item = "hi"


class C1(Mixin1):
    pass


A1().do_stuff()

# This should generate an error because B1 doesn't
# match the protocol.
B1().do_stuff()

# This should generate an error because C1 doesn't
# match the protocol.
C1().do_stuff()


class HasItemProtocol2(Protocol):
    def must_have(self) -> None:
        pass


class Mixin2:
    @classmethod
    def do_stuff(cls: type[HasItemProtocol2]):
        pass


class A2(Mixin2):
    def must_have(self) -> None:
        pass


class B2(Mixin2):
    pass


A2.do_stuff()

# This should generate an error because B2 doesn't
# match the protocol.
B2.do_stuff()


class Bar:
    pass


class Foo:
    @staticmethod
    def get_or_create(context: Bar):
        return object.__getattribute__(context, "")


TFoo2 = TypeVar("TFoo2", bound="Foo2")


class Foo2:
    @classmethod
    def bar(cls: type[TFoo2]) -> TFoo2: ...

    def baz(self) -> None:
        self.bar()


class ClassWithNewOverride:
    def __new__(cls):
        return object.__new__(cls)
