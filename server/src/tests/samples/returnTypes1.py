# This sample tests basic return type analysis and error reporting.

def add(a: int, b: int) -> int:
    c = float(a + b)
    # This should generate an error:
    # Expression of type 'float' cannot be assigned to return type 'int'
    return c

def addf(a: float, b: float) -> float:
    c = float(a + b)
    return c


# This should generate an error:
# Argument of type 'float' cannot be assigned to parameter of type 'int'
add(3.4, 5)

# This should be fine
addf(3, 5)

# This should not produce any error because the function's suite is empty.
def noReturnIsFine() -> bool:
    "Doc strings are allowed"
    ...

