# This sample tests a looping case involving type narrowing within
# a loop where the act of determining whether it's a supported type
# guard results in a circular dependency between variables.

# pyright: reportUnnecessaryComparison=true


def func1():
    a = None
    b = ""

    while True:
        if b != a:
            a = b
