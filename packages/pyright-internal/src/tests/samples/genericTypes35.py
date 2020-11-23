# This sample tests the handling of "higher-order" type
# variables during TypeVar solving. In this example, we
# pass a generic function "identity" to another generic
# function "fmap".

# NOTE: This test is no longer working. It previously worked
# because of the looser handling of TypeVars.

from typing import TypeVar, Callable, Optional

T1 = TypeVar("T1")
U1 = TypeVar("U1")


def identity1(x: T1) -> T1:
    return x


def fmap(f: Callable[[T1], U1], maybe: Optional[T1]) -> Optional[U1]:
    return None


x1: Optional[int] = 0
y1 = fmap(identity1, x1)

if y1 is not None:
    # Make sure we can call an int method on y to confirm
    # that it is an "int".
    y1.conjugate()


# In this variant, use a bound type.
T2 = TypeVar("T2", bound=str)


def identity2(x: T2) -> T2:
    return x


x2: Optional[int] = 0

# This should generate an error because identity2's TypeVar
# T2 is bound to str, so there is no solution that satisfies
# all of the constraints.
y2 = fmap(identity2, x2)

