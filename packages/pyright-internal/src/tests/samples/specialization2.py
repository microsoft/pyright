# This sample tests the special case of specialzing a Union
# type that has generic parameters.

from typing import TypeVar, Generic, Union, Callable
from dataclasses import dataclass

E = TypeVar("E")
A = TypeVar("A")
B = TypeVar("B")

@dataclass
class Left(Generic[E]):
    left: E

@dataclass
class Right(Generic[A]):
    right: A

# Note that this Union type has generic parameters.
Either = Union[Left[E], Right[A]]

def fmap(f: Callable[[A], B], either: Either[E, A]) -> Either[E, B]:
    if isinstance(either, Right):
        return Right(f(either.right))
    else:
        return either

def square(x: int) -> int:
    return x * x

def accepts_only_left_str(p: Left[str]):
    pass

def accepts_only_right_int(p: Right[int]):
    pass

aa = fmap(square, Left("s"))

# This should not generate any errors.
if isinstance(aa, Left):
    accepts_only_left_str(aa)
else:
    accepts_only_right_int(aa)


