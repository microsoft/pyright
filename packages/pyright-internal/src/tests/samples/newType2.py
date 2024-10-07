# This sample tests the special-case handle of the multi-parameter
# form of the built-in "type" call.

# pyright: strict

X1 = type("X1", (object,), {})
X2 = type("X2", (object,), {})


class A(X1): ...


class B(X2, A): ...


# This should generate two errors (one for `__new__` and one for `__init__`)
# because the first arg is not a string.
X3 = type(34, (object,))

# This should generate two errors (one for `__new__` and one for `__init__`)
# because the second arg is not a tuple of class types.
X4 = type("X4", 34)

# This should generate two errors (one for `__new__` and one for `__init__`)
# because the second arg is not a tuple of class types.
X5 = type("X5", (3,))


X6 = type("", tuple({str}), {})
X7 = type("", (float, str), {})


class Meta1(type): ...


X8 = Meta1("X8", (list,), {})
reveal_type(X8, expected_text="type[X8]")
reveal_type(type(X8), expected_text="type[type[X8]]")
