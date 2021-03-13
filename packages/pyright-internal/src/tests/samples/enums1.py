# This sample tests the type checker's handling of Enum.

from enum import Enum, IntEnum
from typing import Literal


TestEnum1 = Enum("TestEnum1", "A B C D")
TestEnum2 = IntEnum("TestEnum2", "AA BB CC DD")


class TestEnum3(Enum):
    A = 0
    B = 1
    C = 2
    D = 3


a = TestEnum1["A"]
aa = TestEnum1.A

# This should generate an error because "Z" isn't
# a valid member.
z = TestEnum1.Z


bb = TestEnum2.BB

# This should generate an error because "A" isn't
# a valid member.
z = TestEnum2.A


b = TestEnum3.B

# This should generate an error because "Z" isn't
# a valid member.
z = TestEnum3.Z


# Test that enum classes are iterable.
list1 = list(TestEnum3)
t1: Literal["list[TestEnum3]"] = reveal_type(list1)

list2 = [i for i in TestEnum3]
t2: Literal["list[TestEnum3]"] = reveal_type(list2)

num_items_in_enum3 = len(TestEnum3)
t3: Literal["int"] = reveal_type(num_items_in_enum3)

t4: Literal["Literal['A']"] = reveal_type(TestEnum3.A.name)
t5: Literal["Literal['A']"] = reveal_type(TestEnum3.A._name_)
t6: Literal["Literal[0]"] = reveal_type(TestEnum3.A.value)
t7: Literal["Literal[0]"] = reveal_type(TestEnum3.A._value_)
