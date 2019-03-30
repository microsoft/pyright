# This sample tests specification of generic types.

from typing import Generic, TypeVar

class A(object):
    pass

class B(A):
    pass

_T1 = TypeVar('_T1', A)

class Moo(Generic[_T1]):
    pass

class Foo(object): 
    def __init__(self) -> None: ...
    def m1(self, a: Moo[A]) -> None: ...
    def m2(self, b: Moo[B]) -> None: ...

a = Moo[A]()
b = Moo[B]()

y = Foo()

y.m1(a)

# This should generate an error:
# Argument of type 'Moo[B]' cannot be assigned to parameter of type 'Moo[A]'
y.m1(b)

# This should generate an error:
# Argument of type 'Moo[A]' cannot be assigned to parameter of type 'Moo[B]'
y.m2(a)

y.m2(b)
