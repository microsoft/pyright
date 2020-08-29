# This sample tests type checking for lambdas and their parameters.
from typing import Any, Callable, Optional, TypeVar

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

def may_need_function_generic(callback: Optional[Callable[[_T1], Any]]):
    pass

may_need_function_generic(lambda x: x)

