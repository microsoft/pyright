# This sample tests the case where a local (constant) variable that
# is assigned a narrowing expression can be used in a type guard condition.


from typing import Literal, Optional, Union
import random


class A:
    a: int


class B:
    b: int


def func1(x: Union[A, B]) -> None:
    is_a = not not isinstance(x, A)

    if not is_a:
        t1: Literal["B"] = reveal_type(x)
    else:
        t2: Literal["A"] = reveal_type(x)


def func2(x: Union[A, B]) -> None:
    is_a = isinstance(x, A)

    if random.random() < 0.5:
        x = B()

    if is_a:
        t1: Literal["B | A"] = reveal_type(x)
    else:
        t2: Literal["B | A"] = reveal_type(x)


def func3(x: Optional[int]):
    is_number = x != None

    if is_number:
        t1: Literal["int"] = reveal_type(x)
    else:
        t2: Literal["None"] = reveal_type(x)


def func4() -> Optional[A]:
    return A() if random.random() < 0.5 else None


maybe_a1 = func4()
is_a1 = maybe_a1

if is_a1:
    t1: Literal["A"] = reveal_type(maybe_a1)
else:
    t2: Literal["None"] = reveal_type(maybe_a1)

maybe_a2 = func4()


def func5():
    global maybe_a2
    maybe_a2 = False


is_a2 = maybe_a2

if is_a2:
    t3: Literal["A | None"] = reveal_type(maybe_a2)
else:
    t4: Literal["A | None"] = reveal_type(maybe_a2)


def func6(x: Union[A, B]) -> None:
    is_a = isinstance(x, A)

    for y in range(1):
        if is_a:
            t1: Literal["A | B"] = reveal_type(x)
        else:
            t2: Literal["A | B"] = reveal_type(x)

        if random.random() < 0.5:
            x = B()
