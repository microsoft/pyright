# This sample tests the case where a local (constant) variable that
# is assigned a narrowing expression can be used in a type guard condition.
# These are sometimes referred to as "aliased conditional expressions".


import random


class A:
    a: int


class B:
    b: int


def func1(x: A | B) -> None:
    is_a = not not isinstance(x, A)

    if not is_a:
        reveal_type(x, expected_text="B")
    else:
        reveal_type(x, expected_text="A")


def func2(x: A | B) -> None:
    is_a = isinstance(x, A)

    if random.random() < 0.5:
        x = B()

    if is_a:
        reveal_type(x, expected_text="B | A")
    else:
        reveal_type(x, expected_text="B | A")


def func3(x: int | None):
    is_number = x != None

    if is_number:
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="None")


def func4() -> A | None:
    return A() if random.random() < 0.5 else None


maybe_a1 = func4()
is_a1 = maybe_a1

if is_a1:
    reveal_type(maybe_a1, expected_text="A")
else:
    reveal_type(maybe_a1, expected_text="None")

maybe_a2 = func4()


def func5():
    global maybe_a2
    maybe_a2 = False


is_a2 = maybe_a2

if is_a2:
    reveal_type(maybe_a2, expected_text="A | None")
else:
    reveal_type(maybe_a2, expected_text="A | None")


def func6(x: A | B) -> None:
    is_a = isinstance(x, A)

    for y in range(1):
        if is_a:
            reveal_type(x, expected_text="A | B")
        else:
            reveal_type(x, expected_text="A | B")

        if random.random() < 0.5:
            x = B()


def get_string() -> str: ...


def get_optional_string() -> str | None: ...


def func7(val: str | None = None):
    val = get_optional_string()

    val_is_none = val is None

    if val_is_none:
        val = get_string()

    reveal_type(val, expected_text="str")


def func8(val: str | None = None):
    val = get_optional_string()

    val_is_none = val is None

    val = get_optional_string()

    if val_is_none:
        val = get_string()

    reveal_type(val, expected_text="str | None")


def func9(var: str | None = None):
    if var_not_None := not (var is None):
        reveal_type(var, expected_text="str")

    reveal_type(var, expected_text="str | None")

    if var_not_None:
        reveal_type(var, expected_text="str")

    if 1 > 1 + 2:
        var = None
    else:
        var = "a" + "b"

    if var_not_None:
        reveal_type(var, expected_text="Literal['ab'] | None")
