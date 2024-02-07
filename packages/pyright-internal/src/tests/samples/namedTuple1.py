# This sample tests the type checker's handling of named tuples.

from collections import namedtuple
from typing import Final, NamedTuple

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

s1: tuple[float, float] = NamedTuple1(3, 4)

# This should generate an error because there are not enough entries.
s2: tuple[float, float, float] = NamedTuple1(3, 4)

NamedTuple2 = namedtuple("NamedTuple2", "field1,    field2")
NamedTuple2.__new__.__defaults__ = ([],)
NamedTuple2()
NamedTuple2(1)

NamedTuple2(field1=1, field2=3)

# This should generate an error because there
# should be two or fewer parameters.
NamedTuple2(1, 2, 3)

Field1: Final = "field1"
Field2: Final = "field2"

NamedTuple3 = NamedTuple(
    "NamedTuple3",
    [
        (Field1, "str"),  # 'str' should be treated as forward reference
        (Field2, int),
    ],
)
NamedTuple3("hello", 2)

# This should generate an error because of a
# type mismatch.
NamedTuple3("1", "2")

# This should generate an error because of a
# type mismatch.
NamedTuple3(field2=1, field1=2)

t1: tuple[str, float] = NamedTuple3("hello", 2)

# This should generate an error because the types are incompatible.
t2: tuple[float, float] = NamedTuple3("hello", 2)

# This should generate an error because the lengths are incompatible.
t3: tuple[str, float, str] = NamedTuple3("hello", 2)

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


def func1(dyn_str: str):
    NamedTuple7 = namedtuple("NamedTuple7", dyn_str)

    n = NamedTuple7()
    a, b = n
    reveal_type(a, expected_text="Any")
    reveal_type(b, expected_text="Any")


def func2():
    NamedTuple8 = namedtuple("NamedTuple8", ("a", "b", "c"))
    n1 = NamedTuple8(a=1, b=2, c=3)

    a, b, c = n1
    reveal_type(a, expected_text="Unknown")
    reveal_type(b, expected_text="Unknown")
    reveal_type(c, expected_text="Unknown")

    # This should generate an error.
    n2 = NamedTuple8(a=1, b=2)


# This should generate an error because NamedTuple isn't allowed in isinstance.
if isinstance(1, NamedTuple):
    pass
