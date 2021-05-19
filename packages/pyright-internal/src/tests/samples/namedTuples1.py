# This sample tests the type checker's handling of named tuples.

from collections import defaultdict, namedtuple
from typing import NamedTuple, Tuple

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

s1: Tuple[float, float] = NamedTuple1(3, 4)

# This should generate an error because there are not enough entries.
s2: Tuple[float, float, float] = NamedTuple1(3, 4)

NamedTuple2 = namedtuple("NamedTuple2", "field1,    field2")
NamedTuple2.__new__.__defaults__ = ([],)
NamedTuple2()
NamedTuple2(1)

NamedTuple2(field1=1, field2=3)

# This should generate an error because there
# should be two or fewer parameters.
NamedTuple2(1, 2, 3)


NamedTuple3 = NamedTuple(
    "NamedTuple3",
    [
        ("field1", "str"),  # 'str' should be treated as forward reference
        ("field2", int),
    ],
)
NamedTuple3("hello", 2)

# This should generate an error because of a
# type mismatch.
NamedTuple3("1", "2")

# This should generate an error because of a
# type mismatch.
NamedTuple3(field2=1, field1=2)

t1: Tuple[str, float] = NamedTuple3("hello", 2)

# This should generate an error because the types are incompatible.
t2: Tuple[float, float] = NamedTuple3("hello", 2)

# This should generate an error because the lengths are incompatible.
t3: Tuple[str, float, str] = NamedTuple3("hello", 2)

t4: NamedTuple = NamedTuple3("hello", 2)

NamedTuple4 = namedtuple("NamedTuple4", "field1 field2 field3", defaults=(1, 2))

# This should generate an error (too few params)
NamedTuple4()
NamedTuple4(1)
NamedTuple4(1, 2, 3)
# This should generate an error (too many params)
NamedTuple4(1, 2, 3, 4)

NamedTuple5 = namedtuple(
    "NamedTuple5", "field1 field2 field3", defaults=(1, 2, 3, 4, 5)
)
NamedTuple5()

NamedTuple6 = namedtuple("NamedTuple6", "field1 field2 field3", defaults=[1, 2])
NamedTuple6()
