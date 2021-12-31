# This sample tests the case where a local (constant) variable that
# is assigned a narrowing expression can be used in a type guard condition.
# These are sometimes referred to as "aliased conditional expressions".


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


def get_string() -> str:
    ...


def get_optional_string() -> Optional[str]:
    ...


def func7(val: Optional[str] = None):
    val = get_optional_string()

    val_is_none = val is None

    if val_is_none:
        val = get_string()

    t1: Literal["str"] = reveal_type(val)


def func8(val: Optional[str] = None):
    val = get_optional_string()

    val_is_none = val is None

    val = get_optional_string()

    if val_is_none:
        val = get_string()

    t1: Literal["str | None"] = reveal_type(val)


def func9(var: Optional[str] = None):
    if var_not_None := not (var is None):
        t1: Literal["str"] = reveal_type(var)

    t2: Literal["str | None"] = reveal_type(var)

    if var_not_None:
        t3: Literal["str"] = reveal_type(var)

    if 1 > 1 + 2:
        var = None
    else:
        var = "" + ""

    if var_not_None:
        t4: Literal["str | None"] = reveal_type(var)
