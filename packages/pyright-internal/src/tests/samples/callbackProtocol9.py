# This sample tests that a call through a __call__ handles the case
# where the __call__ is a callable object itself.


class A:
    def __call__(self, v: int):
        print("Received", v)


class B:
    __call__ = A()


class C:
    __call__ = B()


class D:
    __call__ = C()


d = D()

d(1)

# This should generate an error because of the incompatible argument type.
d("1")

# This should generate an error because of the wrong argument count.
d(1, 1)
