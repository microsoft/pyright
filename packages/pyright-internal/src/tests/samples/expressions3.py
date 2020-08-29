# This sample tests various unary expressions.

def returnsFloat1() -> float:
    a = 1
    b = not a

    # This should generate an error because bool
    # cannot be assigned to a float.
    return b

def returnsInt1() -> int:
    a = 1
    b = -a
    return b

def returnsInt2() -> int:
    a = 1
    b = +a
    return b

def returnsInt3() -> int:
    a = 4
    b = ~a
    return b


