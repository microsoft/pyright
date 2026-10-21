# This sample tests that functools.partial handles *args parameters that
# are annotated with an unpacked TypeVarTuple. This test is based on
# issue 11879.

from collections.abc import Callable
from functools import partial
from typing import TypeVarTuple

_DataTs = TypeVarTuple("_DataTs")


def idle_add(
    function: Callable[[*_DataTs], bool],
    *user_data: *_DataTs,
) -> int:
    return 1


def test(a: str, b: int) -> bool:
    return True


# The TypeVarTuple is solved as (str, int) based on the first argument, so
# the bound argument "a" matches the first element of the solution.
method = partial(idle_add, test, "a")
reveal_type(method.__call__, expected_text="(*user_data: *tuple[int]) -> int")

# This should generate no error because the remaining argument must be an int.
method(1)

# This should generate an error because "x" is not compatible with int.
method("x")

# This should generate an error because only one argument remains.
method(1, 2)


# This should generate an error because the bound argument 1 is not
# compatible with the first element of the TypeVarTuple solution.
partial(idle_add, test, 1)


# No arguments are bound to the *user_data parameter here, so the
# TypeVarTuple solution spans the entire parameter.
method2 = partial(idle_add, test)
reveal_type(method2.__call__, expected_text="(str, int) -> int")

# This should generate no error.
method2("a", 1)

# This should generate an error because the *user_data parameter accepts
# only two arguments.
method2("a", 1, 2)


# Both elements of the TypeVarTuple solution are consumed by the bound
# arguments, so no arguments remain.
method3 = partial(idle_add, test, "a", 1)

# This should generate no error.
method3()

# This should generate an error because no arguments remain.
method3(2)


# Here the TypeVarTuple is not solved by any other argument, so the bound
# arguments are deferred to a new TypeVarTuple that is solved when the
# partial object is called.


def variadic_func(*args: *_DataTs) -> tuple[*_DataTs]:
    return args


variadic = partial(variadic_func, "a")
reveal_type(
    variadic.__call__,
    expected_text="(*args: *_DataTs2@variadic_func) -> tuple[str, *_DataTs2@variadic_func]"
)

# These should generate no errors.
variadic("b")
variadic("b", 2)
variadic()

reveal_type(variadic("b"), expected_text="tuple[str, str]")
reveal_type(variadic("b", 2), expected_text="tuple[str, str, int]")

# The deferred TypeVarTuple accepts any type, so no error is expected here.
variadic_int = partial(variadic_func, 2)
reveal_type(variadic_int(1), expected_text="tuple[int, int]")

# The deferred TypeVarTuple persists through another partial application.
variadic2 = partial(variadic, "b")
variadic2(1)
reveal_type(variadic2(1), expected_text="tuple[str, str, int]")
