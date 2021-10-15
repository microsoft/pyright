# This sample tests the type checker's handling of generic protocol types.

from typing import List, Optional, TypeVar, Protocol

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)


class Box(Protocol[T_co]):
    def content(self) -> T_co:
        ...


class Box_Impl:
    def content(self) -> int:
        ...


box: Box[float]
second_box: Box[int] = Box_Impl()

# This should not generate an error due to the covariance of 'Box'.
box = second_box


class Sender(Protocol[T_contra]):
    def send(self, data: T_contra) -> int:
        ...


class Sender_Impl:
    def send(self, data: float) -> int:
        ...


sender: Sender[float] = Sender_Impl()
new_sender: Sender[int]

# This should not generate an error because 'Sender' is contravariant.
new_sender = sender


class Proto(Protocol[T]):
    def m1(self, p0: T) -> None:
        pass

    attr: T


class Proto_Impl:
    def m1(self, p0: int) -> None:
        pass

    attr: int


class NotProto2:
    attr: int


var: Proto[float]
another_var: Proto[int] = Proto_Impl()

# This should generate an error because T is invariant.
var = another_var

another_var2: NotProto2 = NotProto2()

# This should generate an error because T is invariant.
var = another_var2


# This should generate an error because "Protocol" cannot be used
# as a type argument.
var2: List[Protocol] = []


class Abstract1(Protocol[T_contra]):
    def do(self, x: Optional[T_contra]):
        ...


class Concrete1:
    def do(self, x: Optional[int]):
        pass


def use_protocol1(a: Abstract1[int]):
    a.do(1)


use_protocol1(Concrete1())
