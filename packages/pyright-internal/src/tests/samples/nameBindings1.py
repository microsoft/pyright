# Tests the type checker's handling of global and nonlocal keywords.

global a

a = 3
f = 3

# This should generate an error because nonlocal bindings aren't
# allowed at the module level.
nonlocal b


def func1():
    global a


def func2():
    global c


def func3():
    a = 3
    # This should generate an error because a is assigned locally
    # before its name binding is declared.
    global a

    d = 3
    h = 3

    def func3_1():
        nonlocal d

        h = 5

        # This should generate an error because h is assigned
        # locally before its name binding is declared.
        nonlocal h

        global e

        # This should generate an error because f is not available
        # in a nonlocal scope.
        nonlocal f

        nonlocal g

    e = 4
    g = 10
