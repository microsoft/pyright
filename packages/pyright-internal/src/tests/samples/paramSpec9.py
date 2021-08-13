# This sample tests the handling of a ParamSpec used with
# *args: P.args, **kwargs: P.kwargs.

from typing import Any, Callable, ParamSpec


P = ParamSpec("P")


def twice(f: Callable[P, int], *args: P.args, **kwargs: P.kwargs) -> int:
    return f(*args, **kwargs) + f(*args, **kwargs)


def a_int_b_str(a: int, b: str) -> int:
    return 1


twice(a_int_b_str, 1, "A")  # Accepted

twice(a_int_b_str, b="A", a=1)  # Accepted

twice(a_int_b_str, 1, b="hi")  # Accepted

# This should generate an error because b is a incorrect type.
twice(a_int_b_str, 1, b=2)  # Rejected

# This should generate an error because a is a incorrect type.
twice(a_int_b_str, "1", b="2")  # Rejected

# This should generate an error because c is unknown.
twice(a_int_b_str, 1, c=2)  # Rejected

# This should generate an error because c is unknown.
twice(a_int_b_str, 1, b="hi", c=2)  # Rejected

# This should generate an error because type of a is wrong.
twice(a_int_b_str, "A", "1")  # Rejected

# This should generate an error because type of b is wrong.
twice(a_int_b_str, 1, 1)  # Rejected

# This should generate an error because of too many arguments.
twice(a_int_b_str, 1, "1", 2)  # Rejected

# This should generate an error because of too few arguments.
twice(a_int_b_str, 1)  # Rejected

# This should generate an error because of too few arguments.
twice(a_int_b_str)  # Rejected


def func1(func: Callable[P, Any], *args: P.args, **kwargs: P.kwargs):
    pass


def func2(func: Callable[P, Any], *args: P.args, **kwargs: P.kwargs):
    func1(func, *args, **kwargs)
