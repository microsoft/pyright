# This sample tests that @runtime_checkable can be applied only to
# classes that are protocols (Protocol must appear in the base list).

from typing import Protocol, runtime_checkable


@runtime_checkable
class P1(Protocol):
    def foo(self) -> int: ...


# This should generate an error because a subclass of a protocol is
# not itself a protocol unless Protocol is listed as a base class.
@runtime_checkable
class P2(P1):
    def bar(self) -> str: ...


@runtime_checkable
class P3(P1, Protocol):
    def bar(self) -> str: ...


# This should generate an error because C1 is not a protocol.
@runtime_checkable
class C1:
    def foo(self) -> int: ...


# Class decorators are applied bottom-up, so runtime_checkable receives
# the class produced by the decorator below it.
def replace_with_protocol(cls: type) -> type[P1]: ...


def replace_with_non_protocol(cls: type) -> type[C1]: ...


@runtime_checkable
@replace_with_protocol
class C2:
    pass


# This should generate an error because the decorator below
# runtime_checkable replaces the class with a non-protocol class.
@runtime_checkable
@replace_with_non_protocol
class P4(Protocol):
    pass
