# This sample tests type checking for lambdas and their parameters.
from typing import Any, Callable, Iterable, TypeVar

#------------------------------------------------------
# Test basic lambda matching

def needs_function(callback: Callable[[str, int], str]):
    pass

needs_function(lambda x, y:x)

# This should generate an error because the lambda doesn't
# accept two parameters.
needs_function(lambda x:x)


#------------------------------------------------------
# Test lambda matching when dest includes default parameter values

def needs_function2(callback: Callable[[str, int], str]):
    pass

needs_function(lambda x, y:x)


#------------------------------------------------------
# Test parameter rules for lambdas

# This should generate an error because a parameter with
# no default follows a parameter with a default.
lambda2 = lambda x=1, y:y

lambda3 = lambda x, y=5:y
lambda3(1)
lambda3(1, 2)

lambda4 = lambda x, *y, z:y


#------------------------------------------------------
# Test calling of lambdas

lambda1 = lambda x, y:x
lambda1(1, 2)

# This should generate an error because the lambda doesn't
# accept three parameters.
lambda1(1, 2, 3)

lambda4(1, z=3)
lambda4(1, 3, 4, 5, 6, z=3)

# This should generate an error because the arguments
# don't match the parameter list.
lambda4(1, 3)

# This should generate an error because the arguments
# don't match the parameter list (no named value for z).
lambda4(1, 3, 4)


#------------------------------------------------------
# Test generic parameter matching in lambdas

_T1 = TypeVar('_T1')

def may_need_function_generic(callback: Callable[[_T1], _T1] | None):
    pass

may_need_function_generic(lambda x: x)


def reduce(function: Callable[[_T1, _T1], _T1], sequence: Iterable[_T1]) -> _T1:
    ...


a: object = reduce((lambda x, y: x * y), [1, 2, 3, 4])


#------------------------------------------------------
# Test lambdas with *args

b1: Callable[[int, int, str], Any] = lambda _, *b: reveal_type(
    b, expected_text="tuple[Unknown, ...]"
)

b2: Callable[[str, str], Any] = lambda *b: reveal_type(
    b, expected_text="tuple[Unknown, ...]"
)

b3: Callable[[int], Any] = lambda _, *b: reveal_type(
    b, expected_text="tuple[Unknown, ...]"
)
