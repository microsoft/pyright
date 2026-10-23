# This sample tests that @runtime_checkable can be applied only to
# classes that are protocols (Protocol must appear in the base list).

from typing import Any, Protocol, final, runtime_checkable


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


# No error should be reported when the decorator below runtime_checkable
# produces a type that is not a single known class.
def replace_with_any(cls: type) -> Any: ...


def replace_with_union(cls: type) -> type[P1] | type[C1]: ...


def replace_with_object(cls: type) -> type[object]: ...


@runtime_checkable
@replace_with_any
class C3:
    pass


@runtime_checkable
@replace_with_union
class C4:
    pass


@runtime_checkable
@replace_with_object
class P5(Protocol):
    pass


class P6(Protocol):
    def baz(self) -> int: ...


def replace_with_p6(cls: type) -> type[P6]: ...


# A type[P6] return annotation does not identify the P6 class object, so
# applying runtime_checkable should not mark P6 itself runtime-checkable.
@runtime_checkable
@replace_with_p6
class C5:
    pass


def func1(val: object):
    # This should generate an error because P6 is not runtime-checkable.
    isinstance(val, P6)


def identity_or_p1[T](cls: T) -> T | type[P1]: ...


# When the decorator below runtime_checkable produces a union that
# includes the declared protocol, that protocol is still marked
# runtime-checkable.
@runtime_checkable
@identity_or_p1
class P7(Protocol):
    def qux(self) -> int: ...


def func2(val: object, cls: type):
    isinstance(val, P7)
    issubclass(cls, P7)


# The unparameterized list deliberately makes the return type Unknown.
def replace_with_unknown(cls: type, classes: list = [P1]):
    return classes[0]


def identity[T](cls: T) -> T:
    return cls


@runtime_checkable
@replace_with_unknown
class C6:
    def foo(self) -> int:
        return 1


@runtime_checkable
@identity
@replace_with_unknown
class C7:
    pass


@runtime_checkable
@final
@replace_with_unknown
class C8:
    pass


@runtime_checkable
@runtime_checkable
@replace_with_unknown
class C9:
    pass


# A known replacement above the Unknown result restores validation.
# This should generate an error because C1 is not a protocol.
@runtime_checkable
@replace_with_non_protocol
@replace_with_unknown
class C10:
    pass


@runtime_checkable
@identity
@replace_with_unknown
class P8(Protocol):
    def baz(self) -> int: ...


def func3(val: object, cls: type):
    isinstance(val, P8)
    issubclass(cls, P8)


reveal_type(C6, expected_text="type[C6]")
reveal_type(C6().foo(), expected_text="int")
reveal_type(C7, expected_text="type[C7]")
reveal_type(C8, expected_text="type[C8]")
reveal_type(C9, expected_text="type[C9]")
reveal_type(C10, expected_text="type[C1]")
reveal_type(P8, expected_text="type[P8]")


def class_identity[T](cls: type[T]) -> type[T]:
    return cls


@runtime_checkable
@class_identity
@replace_with_unknown
class C11:
    pass


reveal_type(C11, expected_text="type[C11]")
