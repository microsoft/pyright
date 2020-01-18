# This sample tests the type checker's handling of named tuples.

from collections import namedtuple
from typing import NamedTuple

NamedTuple1 = namedtuple("NamedTuple1", "field1 field2")
NamedTuple1(1, 2)
NamedTuple1(field2=1, field1=2)

# This should generate an error because there
# is no field called field3.
NamedTuple1(field1=1, field2=3, field3=2)

# This should generate an error because there
# should be two parameters.
NamedTuple1(1)

# This should generate an error because there
# should be two parameters.
NamedTuple1(1, 2, 3)


NamedTuple2 = namedtuple("NamedTuple2", "field1,    field2")
NamedTuple2.__new__.__defaults__ = ([], )
NamedTuple2()
NamedTuple2(1)

NamedTuple2(field1=1, field2=3)

# This should generate an error because there
# should be two or fewer parameters.
NamedTuple2(1, 2, 3)


NamedTuple3 = NamedTuple("NamedTuple3", [
    ('field1', 'str'), # 'str' should be treated as forward reference
    ('field2', int)
])
NamedTuple3('hello', 2)

# This should generate an error because of a
# type mismatch.
NamedTuple3('1', '2')

# This should generate an error because of a
# type mismatch.
NamedTuple3(field2=1, field1=2)

