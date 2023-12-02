# This sample tests the type checker's handling
# of proper method resolution order (MRO).

# pyright: reportIncompatibleMethodOverride=false


class A:
    def foo(self, v1: str):
        return None

    def bar(self):
        return None


class B(A):
    def foo(self, v1: float):
        return None


class C(A):
    def foo(self, v1: A):
        return None

    def bar(self, v1: float):
        return None


class D(B, C):
    pass


a = A()
a.foo("hello")

b = B()
b.foo(3)

c = C()
c.foo(a)

d = D()
d.foo(3)

# This should generate an error because
# the bar method from class C should be
# selected before the bar method from A.
d.bar()
