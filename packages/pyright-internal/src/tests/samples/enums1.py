# This sample tests the type checker's handling of Enum.

from enum import Enum, IntEnum


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
reveal_type(list1, expected_text="list[TestEnum3]")

list2 = [i for i in TestEnum3]
reveal_type(list2, expected_text="list[TestEnum3]")

num_items_in_enum3 = len(TestEnum3)
reveal_type(num_items_in_enum3, expected_text="int")

reveal_type(TestEnum3.A.name, expected_text="Literal['A']")
reveal_type(TestEnum3.A._name_, expected_text="Literal['A']")
reveal_type(TestEnum3.A.value, expected_text="Literal[0]")
reveal_type(TestEnum3.A._value_, expected_text="Literal[0]")
