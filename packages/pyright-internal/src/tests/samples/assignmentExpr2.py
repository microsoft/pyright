# This sample tests the Python 3.8 assignment expressions. This sample
# is taken from PEP 257.

# pyright: reportUnusedExpression=false

import re

def func1(x: float):
    ...

def pep572_examples():
    if (match := re.search('123', '252')) is not None:
        print(match)
    print(match)

    file = open('hello')
    while chunk := file.read(8192):
        print(chunk)
    print(chunk)

    def f(x: float):
        return x
    mylist = [y := f(25), y**2, y**3]

    data = [1, 2, 3]
    filtered_data = [y for x in data if (y := f(x)) is not None]
    print(filtered_data)
    
    # This should generate an error.
    y := f(25)  # INVALID
    (y := f(25))  # Valid, though not recommended

    y1 = 1

    # This should generate an error.
    y0 = y1 := f(25)  # INVALID
    y0 = (y1 := f(25))  # Valid, though discouraged

    # This should generate an error.
    func1(x = y := f(25))  # INVALID
    func1(x=(y := f(25)))  # Valid, though probably confusing

    # This should generate an error.
    [y for x in [0, 1] if y := x - 1]

    [y for x in [0, 1] if (y := x - 1)]


def func2():
    # This should generate an error.
    yield y := 1

def func3():
    # This should generate an error.
    yield from y := [1]

def func4():
    # This should generate an error.
    v1 = {x := 'a': 0}

    v2 = {(x := 'a'): 0}

    # This should generate an error.
    v3 = {x := 'a': i for i in range(4)}

    v4 = {(x := 'a'): i for i in range(4)}

