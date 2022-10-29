# This sample tests the reportUnnecessaryComparison diagnostic check
# when applied to functions that appear within a conditional expression.


from typing import Literal


def cond() -> bool:
    ...


# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if cond:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if 0 or cond:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if 1 and cond:
    pass

if cond():
    pass
# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
elif cond:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
def func1():
    while cond:
        pass


# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
a = [x for x in range(20) if cond]

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
a = 1 if cond else 2


def func2():
    x = 1

    # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
    if x == 1:
        ...

    # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
    if x != 1:
        ...

def func3(x: object):
    match x:
        case 1:
            # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
            if x == 1:
                ...

            # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
            if x != 1:
                ...


def func4(x: Literal["a", "b"], y: Literal["a"]):
    if cond():
        z = "a"
    else:
        z = "b"
    
    # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
    if x == z:
        ...
    
    # This should generate a diagnostic when reportUnnecessaryComparison is enabled.
    if x != z:
        ...

    if x == y:
        ...

    if x != y:
        ...

