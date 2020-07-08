# This sample tests the special-case handle of the multi-parameter
# form of the built-in "type" call.

# pyright: strict

X1 = type("X1", (object,), dict())
X2 = type("X2", (object,), dict())


class A(X1):
    ...


class B(X2, A):
    ...


X3 = type(34, (object,))

X4 = type("X4", 34)

# This should generate an error because the second arg is not a tuple of class types.
X5 = type("X5", (3,))

