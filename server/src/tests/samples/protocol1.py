# This sample tests the type checker's handling of generic protocol types.

from typing import TypeVar, Protocol

T = TypeVar('T')
T_co = TypeVar('T_co', covariant=True)
T_contra = TypeVar('T_contra', contravariant=True)

class Box(Protocol[T_co]):
    def content(self) -> T_co:
        ...

box: Box[float]
second_box: Box[int]

# This should not generate an error due to the covariance of 'Box'.
box = second_box


class Sender(Protocol[T_contra]):
    def send(self, data: T_contra) -> int:
        ...

sender: Sender[float]
new_sender: Sender[int]

# This should not generate an error because 'Sender' is contravariant.
new_sender = sender


class Proto(Protocol[T]):
    attr: T


class NotProto2:
    attr: int

var: Proto[float]
another_var: Proto[int]

# This should generate an error because T is invariant.
var = another_var

another_var2: NotProto2

# This should generate an error because T is invariant.
var = another_var2
