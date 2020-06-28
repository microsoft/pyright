# This sample tests the type checker's reporting of
# incompatible declared types.

from typing import List


def a():
    pass

# This should generate two errors - one for
# overriding the function declaration and another
# for an incompatible assignment.
a = 1

# This should generate an error for an obscured type.
def b():
    pass
b: int = 1

# This should generate an error for an obscured type.
c: int = 1
c: float = 1.1

# This should generate two errors - one for an
# obscured type, the second for an incompatible assignment.
d: int = 2
def d():
    pass


class Foo:
    # This should generate an error because of an
    aa: int

    def aa(self):
        return 3
    

# This should generate two errors, one for each param.
def my_func(param1: int, param2):
    param1: int = 3
    param2: int = 4


# This should be fine because both declarations of 'e'
# use the same type.
e: List[int]
e = [3]
e: List[int]


