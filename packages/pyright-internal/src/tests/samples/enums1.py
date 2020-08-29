# This sample tests the type checker's handling of Enum.

from enum import Enum, IntEnum
from typing import List


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
def requires_enum3_list(a: List[TestEnum3]):
    return

list1 = list(TestEnum3)
requires_enum3_list(list1)

list2 = [i for i in TestEnum3]
requires_enum3_list(list2)

num_items_in_enum3 = len(TestEnum3)
