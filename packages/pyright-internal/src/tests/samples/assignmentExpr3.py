# This sample tests the Python 3.8 assignment expressions.

import re

def foo1(x: float):
    ...

p = 3

# This should generate an error.
def foo2(answer = p := 42):  # INVALID
    ...

def foo3(answer=(p := 42)):  # Valid, though not great style
    ...

default_value: int = 3

# This should generate two errors.
def foo4(answer: p := default_value = 5):  # INVALID
    ...

# This should generate an error.
(lambda: x := 1) # INVALID
lambda: (x := 1) # Valid, but unlikely to be useful
(x := lambda: 1) # Valid
lambda line: (m := re.match('pattern', 'line')) and m.group(1) # Valid
