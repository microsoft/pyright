# This sample tests various arithmetic expressions.


def returnsInt1() -> int:
    a = 1
    b = 2

    return a + b % b // a - b // a


def returnsInt2() -> int:
    a = 1.0
    b = 2

    # This should generate an error because
    # it should evaluate to a float, which is
    # not compatible with the specified return
    # type.
    return a + b % b // a - b // a


def returnsFloat1() -> float:
    a = 1
    b = 2
    return a + b % b / a - b // a


def returnsFloat2() -> float:
    a = complex(1, 2)
    b = 2

    # This should generate an error because it
    # should evaluate to a complex, which is
    # not compatible with the specified return
    # type.
    return a + b % b / a - b // a


def returnsComplex1() -> complex:
    a = complex(1, 2)
    b = 2
    c = 4.0

    # This should generate an error because a
    # float should be divisible by a complex.
    return a + b % (b / a - c // a)


a = 3
b = 4

# This should generate an error because matrix multiply
# isn't supported for int.
c = a @ b
