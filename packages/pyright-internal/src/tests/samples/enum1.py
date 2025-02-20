# This sample tests the type checker's handling of Enum.

from enum import Enum, EnumMeta, IntEnum
from typing import Self


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

reveal_type(TestEnum3["A"], expected_text="TestEnum3")

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


class TestEnum9(Enum):
    _other1: int
    _other2: int

    def __new__(cls, value: str, other1: int, other2: int):
        obj = object.__new__(cls)
        obj._value_ = value
        obj._other1 = other1
        obj._other2 = other2
        return obj

    A = ("a", 1, 2)
    B = ("b", 2, 3)


te9_A = TestEnum9.A
reveal_type(te9_A, expected_text="Literal[TestEnum9.A]")
reveal_type(te9_A.value, expected_text="Any")
reveal_type(te9_A._value_, expected_text="Any")
reveal_type(te9_A.name, expected_text="Literal['A']")
reveal_type(te9_A._name_, expected_text="Literal['A']")


class CustomEnumMeta1(EnumMeta):
    pass


class TestEnum10(Enum, metaclass=CustomEnumMeta1):
    A = 1
    B = 2


te10_A = TestEnum10.A
reveal_type(te10_A, expected_text="Literal[TestEnum10.A]")
reveal_type(te10_A.value, expected_text="Any")
reveal_type(te9_A._value_, expected_text="Any")
reveal_type(te9_A.name, expected_text="Literal['A']")
reveal_type(te9_A._name_, expected_text="Literal['A']")


def func2(e: type[Enum]):
    values = {v.value for v in e}
    reveal_type(values, expected_text="set[Any]")

    names = {v.name for v in e}
    reveal_type(names, expected_text="set[str]")


class TestEnum11(Enum):
    (A, B, C) = range(3)


te11_A = TestEnum11.A
reveal_type(te11_A, expected_text="Literal[TestEnum11.A]")
reveal_type(te11_A.value, expected_text="int")


def func3(self) -> None:
    pass


class TestEnum12(Enum):
    a = 1
    b = lambda self: None
    c = func3


reveal_type(TestEnum12.a, expected_text="Literal[TestEnum12.a]")
reveal_type(TestEnum12.b, expected_text="(self: Unknown) -> None")
reveal_type(TestEnum12.c, expected_text="(self: Unknown) -> None")


class TestEnum13(metaclass=CustomEnumMeta1):
    pass


TestEnum14 = TestEnum13("TestEnum14", "A, B, C")
reveal_type(TestEnum14.A, expected_text="Literal[TestEnum14.A]")


class TestEnum15(Enum):
    _value_: str
    A = 1
    B = 2

    def __init__(self, value: int):
        self._value_ = str(value)


te15_A = TestEnum15.A
reveal_type(te15_A, expected_text="Literal[TestEnum15.A]")
reveal_type(te15_A.value, expected_text="str")
reveal_type(te15_A._value_, expected_text="str")


class TestEnum16(IntEnum):
    A = 1
    B = 2
    C = 3

    D = C  # Alias for C


reveal_type(TestEnum16.D, expected_text="Literal[TestEnum16.C]")
reveal_type(TestEnum16.D.value, expected_text="Literal[3]")


class TestEnum17(IntEnum):
    def __new__(cls, val: int, doc: str) -> Self:
        obj = int.__new__(cls, val)
        obj._value_ = val
        obj.__doc__ = doc
        return obj


class TestEnum18(TestEnum17):
    A = (1, "A")
    B = (2, "B")


class TestEnum19(Enum):
    A = 1
    __B = 2


reveal_type(TestEnum19.A, expected_text="Literal[TestEnum19.A]")
reveal_type(TestEnum19.__B, expected_text="Literal[2]")


class TestEnum20(Enum):
    A = 1
    B = A + 1


reveal_type(TestEnum20.A, expected_text="Literal[TestEnum20.A]")
reveal_type(TestEnum20.A.value, expected_text="Literal[1]")
reveal_type(TestEnum20.B, expected_text="Literal[TestEnum20.B]")
reveal_type(TestEnum20.B.value, expected_text="Literal[2]")
reveal_type(TestEnum20.A.A.A, expected_text="Literal[TestEnum20.A]")
reveal_type(TestEnum20.A.B.A, expected_text="Literal[TestEnum20.A]")
reveal_type(TestEnum20.A.B, expected_text="Literal[TestEnum20.B]")


class TestEnum21Base(Enum, metaclass=CustomEnumMeta1):
    @property
    def value(self) -> str:
        return "test"


class TestEnum21(TestEnum21Base):
    A = 1


reveal_type(TestEnum21.A.value, expected_text="str")


class TestEnum22Base(Enum):
    @property
    def value(self) -> str:
        return "test"


class TestEnum22(TestEnum22Base):
    A = 1


reveal_type(TestEnum22.A.value, expected_text="str")
