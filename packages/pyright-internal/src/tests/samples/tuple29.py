from types import NotImplementedType
from typing import assert_type


class Meta0(type):
    def __lt__(self, other: type) -> bool:
        return True


class TextMeta0(Meta0):
    def __gt__(self, other: type) -> str:
        return "yes"


class DecliningMeta0(Meta0):
    def __gt__(self, other: type) -> NotImplementedType:
        return NotImplemented


class BooleanMeta0(Meta0):
    def __gt__(self, other: type) -> bool:
        return True


class A0(metaclass=Meta0):
    pass


class B0(A0, metaclass=TextMeta0):
    pass


class C0(A0, metaclass=DecliningMeta0):
    pass


class D0(A0, metaclass=BooleanMeta0):
    pass


_ = (A0, 0) < (B0, 1)  # This should generate an error.
_ = ((A0,), 0) < ((B0,), 1)  # This should generate an error.
assert_type((A0, 0) < (C0, 1), bool)
assert_type(((A0,), 0) < ((C0,), 1), bool)
assert_type((A0, 0) < (D0, 1), bool)
assert_type(((A0,), 0) < ((D0,), 1), bool)

class Meta1(type):
    def __le__(self, other: type) -> bool:
        return True


class TextMeta1(Meta1):
    def __ge__(self, other: type) -> str:
        return "yes"


class DecliningMeta1(Meta1):
    def __ge__(self, other: type) -> NotImplementedType:
        return NotImplemented


class BooleanMeta1(Meta1):
    def __ge__(self, other: type) -> bool:
        return True


class A1(metaclass=Meta1):
    pass


class B1(A1, metaclass=TextMeta1):
    pass


class C1(A1, metaclass=DecliningMeta1):
    pass


class D1(A1, metaclass=BooleanMeta1):
    pass


_ = (A1, 0) <= (B1, 1)  # This should generate an error.
_ = ((A1,), 0) <= ((B1,), 1)  # This should generate an error.
assert_type((A1, 0) <= (C1, 1), bool)
assert_type(((A1,), 0) <= ((C1,), 1), bool)
assert_type((A1, 0) <= (D1, 1), bool)
assert_type(((A1,), 0) <= ((D1,), 1), bool)

class Meta2(type):
    def __gt__(self, other: type) -> bool:
        return True


class TextMeta2(Meta2):
    def __lt__(self, other: type) -> str:
        return "yes"


class DecliningMeta2(Meta2):
    def __lt__(self, other: type) -> NotImplementedType:
        return NotImplemented


class BooleanMeta2(Meta2):
    def __lt__(self, other: type) -> bool:
        return True


class A2(metaclass=Meta2):
    pass


class B2(A2, metaclass=TextMeta2):
    pass


class C2(A2, metaclass=DecliningMeta2):
    pass


class D2(A2, metaclass=BooleanMeta2):
    pass


_ = (A2, 0) > (B2, 1)  # This should generate an error.
_ = ((A2,), 0) > ((B2,), 1)  # This should generate an error.
assert_type((A2, 0) > (C2, 1), bool)
assert_type(((A2,), 0) > ((C2,), 1), bool)
assert_type((A2, 0) > (D2, 1), bool)
assert_type(((A2,), 0) > ((D2,), 1), bool)

class Meta3(type):
    def __ge__(self, other: type) -> bool:
        return True


class TextMeta3(Meta3):
    def __le__(self, other: type) -> str:
        return "yes"


class DecliningMeta3(Meta3):
    def __le__(self, other: type) -> NotImplementedType:
        return NotImplemented


class BooleanMeta3(Meta3):
    def __le__(self, other: type) -> bool:
        return True


class A3(metaclass=Meta3):
    pass


class B3(A3, metaclass=TextMeta3):
    pass


class C3(A3, metaclass=DecliningMeta3):
    pass


class D3(A3, metaclass=BooleanMeta3):
    pass


_ = (A3, 0) >= (B3, 1)  # This should generate an error.
_ = ((A3,), 0) >= ((B3,), 1)  # This should generate an error.
assert_type((A3, 0) >= (C3, 1), bool)
assert_type(((A3,), 0) >= ((C3,), 1), bool)
assert_type((A3, 0) >= (D3, 1), bool)
assert_type(((A3,), 0) >= ((D3,), 1), bool)
