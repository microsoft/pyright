# This sample tests the type checker's handling of Enum.

from enum import Enum, IntEnum


TestEnum1 = Enum("TestEnum1", "   A   B, , ,C , \t D\t")
TestEnum2 = IntEnum("TestEnum2", "AA BB CC DD")


class TestEnum3(Enum):
    A = 0
    B = 1
    C = 2
    D = 3


a = TestEnum1["A"]
aa = TestEnum1.A
reveal_type(aa.name, expected_text="Literal['A']")
reveal_type(aa._name_, expected_text="Literal['A']")
reveal_type(aa.value, expected_text="Literal[1]")
reveal_type(aa._value_, expected_text="Literal[1]")
reveal_type(TestEnum1.D.name, expected_text="Literal['D']")
reveal_type(TestEnum1.D._name_, expected_text="Literal['D']")
reveal_type(TestEnum1.D.value, expected_text="Literal[4]")
reveal_type(TestEnum1.D._value_, expected_text="Literal[4]")


def func1(te3: TestEnum3):
    reveal_type(te3.name, expected_text="Literal['A', 'B', 'C', 'D']")
    reveal_type(te3._name_, expected_text="Literal['A', 'B', 'C', 'D']")
    reveal_type(te3.value, expected_text="Literal[0, 1, 2, 3]")
    reveal_type(te3._value_, expected_text="Literal[0, 1, 2, 3]")


reveal_type(TestEnum3.name, expected_text="property")
reveal_type(TestEnum3._name_, expected_text="str")
reveal_type(TestEnum3.value, expected_text="property")
reveal_type(TestEnum3._value_, expected_text="Any")


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
reveal_type(TestEnum3.B._name_, expected_text="Literal['B']")
reveal_type(TestEnum3.C.value, expected_text="Literal[2]")
reveal_type(TestEnum3.D._value_, expected_text="Literal[3]")


TestEnum4 = Enum("TestEnum4", ["A", "B", "C", "D"])
reveal_type(TestEnum4.A, expected_text="Literal[TestEnum4.A]")
reveal_type(TestEnum4.D, expected_text="Literal[TestEnum4.D]")
reveal_type(TestEnum4.A.name, expected_text="Literal['A']")
reveal_type(TestEnum4.B._name_, expected_text="Literal['B']")
reveal_type(TestEnum4.C.value, expected_text="Literal[3]")
reveal_type(TestEnum4.D._value_, expected_text="Literal[4]")

TestEnum5 = Enum("TestEnum5", ("A", "B", "C", "D"))
reveal_type(TestEnum5.A, expected_text="Literal[TestEnum5.A]")
reveal_type(TestEnum5.D, expected_text="Literal[TestEnum5.D]")
reveal_type(TestEnum5.A.name, expected_text="Literal['A']")
reveal_type(TestEnum5.B._name_, expected_text="Literal['B']")
reveal_type(TestEnum5.C.value, expected_text="Literal[3]")
reveal_type(TestEnum5.D._value_, expected_text="Literal[4]")

d_value = "d"

TestEnum6 = Enum("TestEnum6", [("A", 1), ("B", [1, 2]), ("C", "c"), ("D", d_value)])
reveal_type(TestEnum6.A, expected_text="Literal[TestEnum6.A]")
reveal_type(TestEnum6.D, expected_text="Literal[TestEnum6.D]")
reveal_type(TestEnum6.A.name, expected_text="Literal['A']")
reveal_type(TestEnum6.B._name_, expected_text="Literal['B']")
reveal_type(TestEnum6.A.value, expected_text="Literal[1]")
reveal_type(TestEnum6.B.value, expected_text="list[int]")
reveal_type(TestEnum6.C.value, expected_text="Literal['c']")
reveal_type(TestEnum6.D._value_, expected_text="Literal['d']")

TestEnum7 = Enum("TestEnum7", (("A", 1), ("D", "d")))
reveal_type(TestEnum7.A, expected_text="Literal[TestEnum7.A]")
reveal_type(TestEnum7.D, expected_text="Literal[TestEnum7.D]")
reveal_type(TestEnum7.A.name, expected_text="Literal['A']")
reveal_type(TestEnum7.A.value, expected_text="Literal[1]")
reveal_type(TestEnum7.D._value_, expected_text="Literal['d']")

TestEnum8 = Enum("TestEnum8", {"A": 1, "B": [1, 2], "C": "c", "D": d_value})
reveal_type(TestEnum8.A, expected_text="Literal[TestEnum8.A]")
reveal_type(TestEnum8.D, expected_text="Literal[TestEnum8.D]")
reveal_type(TestEnum8.A.name, expected_text="Literal['A']")
reveal_type(TestEnum8.B._name_, expected_text="Literal['B']")
reveal_type(TestEnum8.A.value, expected_text="Literal[1]")
reveal_type(TestEnum8.B.value, expected_text="list[int]")
reveal_type(TestEnum8.C.value, expected_text="Literal['c']")
reveal_type(TestEnum8.D._value_, expected_text="Literal['d']")
