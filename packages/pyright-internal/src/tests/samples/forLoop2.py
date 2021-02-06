# This sample tests for/else loops for cases where variables
# are potentially unbound.


# For with no break and no else.
def func1():
    for x in []:
        a = 0

    # This should generate a "potentially unbound" error.
    print(a)

    # This should generate a "potentially unbound" error.
    print(x)


# For with no break and else.
def func2():
    for x in []:
        a = 0
    else:
        b = 0

    # This should generate a "potentially unbound" error.
    print(a)

    print(b)

    # This should generate a "potentially unbound" error.
    print(x)


# For with break and else.
def func3():
    for x in []:
        a = 0
        break
    else:
        b = 0

    # This should generate a "potentially unbound" error.
    print(a)

    # This should generate a "potentially unbound" error.
    print(b)

    # This should generate a "potentially unbound" error.
    print(x)
