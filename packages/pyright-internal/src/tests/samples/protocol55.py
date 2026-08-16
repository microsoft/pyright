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
