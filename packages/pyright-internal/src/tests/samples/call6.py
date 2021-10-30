# This sample tests the handling of unpack operators
# used in argument expressions when used in conjunction with
# Tuples and *args parameters.


from typing import Tuple


def foo1(a: int, b: int):
    pass


def foo2(*args: int):
    pass


fixed_tuple_0 = ()
foo1(*fixed_tuple_0, 2)
foo2(*fixed_tuple_0, 2)

fixed_tuple_1 = (1,)
foo1(*fixed_tuple_1, 2)
foo2(*fixed_tuple_1, 2)

fixed_tuple_3 = (1, 3, 5)

# This should generate an error because there
# are too many parameters.
foo1(*fixed_tuple_3, 2)
foo2(*fixed_tuple_3, 2)

homogen_tuple: Tuple[int, ...] = (1, 5, 3)

foo2(*homogen_tuple)
foo2(*homogen_tuple, 2)
