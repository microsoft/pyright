# This sample tests that recursive descriptor accessors do not cause a crash.

from typing import Callable, assert_type


class RecursiveDescriptor:
    __get__: "RecursiveDescriptor"


class DecoratedDescriptor:
    # This should generate an error because the first parameter is not named self.
    def deco(fn):
        return fn

    # This should generate an error because deco expects a DecoratedDescriptor.
    @deco
    def __get__(self, obj: object, owner: type | None = None) -> int:
        return 42


class MutualDescriptor1:
    __get__: "MutualDescriptor2"


class MutualDescriptor2:
    __get__: MutualDescriptor1


class GetterDescriptor:
    def __get__(self, obj: object, owner: type | None = None) -> Callable[..., int]:
        return lambda *args: 42


class NestedDescriptor:
    __get__ = GetterDescriptor()


class Host:
    recursive = RecursiveDescriptor()
    decorated = DecoratedDescriptor()
    mutual = MutualDescriptor1()
    nested = NestedDescriptor()


host = Host()
reveal_type(host.recursive, expected_text="Unknown")
reveal_type(host.decorated, expected_text="Unknown")
reveal_type(host.mutual, expected_text="Unknown")
reveal_type(Host.recursive, expected_text="Unknown")
reveal_type(RecursiveDescriptor.__get__, expected_text="Unknown")
assert_type(host.nested, int)
assert_type(Host.nested, int)
