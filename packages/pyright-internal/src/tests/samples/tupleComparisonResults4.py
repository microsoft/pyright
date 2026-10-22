# Built-in tuple annotations support ordering; explicit subclass contracts remain checked.
from typing import Literal, assert_type

def case_view_False_False_False_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right < left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_False_True_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right < left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_False_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left < right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_True_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left < right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_False_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) < (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_True_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) < (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_False_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) < (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_True_lt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) < (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_parameter_tuple_lt():
    def compare(value: tuple[Literal[1]]) -> bool:
        return (value, 0) < ((2,), 1)

def case_parameter_list_lt():
    def compare(value: list[Literal[1]]) -> bool:
        return (value, 0) < ([2], 1)

def case_view_False_False_False_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right <= left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_False_True_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right <= left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_False_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left <= right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_True_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left <= right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_False_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) <= (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_True_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) <= (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_False_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) <= (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_True_le():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) <= (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_parameter_tuple_le():
    def compare(value: tuple[Literal[1]]) -> bool:
        return (value, 0) <= ((2,), 1)

def case_parameter_list_le():
    def compare(value: list[Literal[1]]) -> bool:
        return (value, 0) <= ([2], 1)

def case_view_False_False_False_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right > left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_False_True_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right > left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_False_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left > right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_True_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left > right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_False_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) > (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_True_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) > (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_False_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) > (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_True_gt():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) > (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_parameter_tuple_gt():
    def compare(value: tuple[Literal[1]]) -> bool:
        return (value, 0) > ((2,), 1)

def case_parameter_list_gt():
    def compare(value: list[Literal[1]]) -> bool:
        return (value, 0) > ([2], 1)

def case_view_False_False_False_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right >= left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_False_True_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = right >= left
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_False_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left >= right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_False_True_True_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = left >= right
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_False_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) >= (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_False_True_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (right, 1) >= (left, 0)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_False_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[Literal[1]] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) >= (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_view_True_True_True_ge():
    def value() -> tuple[Literal[1]]: return (1,)
    left: tuple[int, ...] = value()
    right = (2,)
    assert_type(left, tuple[Literal[1]])
    result = (left, 0) >= (right, 1)
    assert_type(left, tuple[Literal[1]])
    def one(value: Literal[1]) -> int: return value + 1
    assert one(left[0]) == 2
    assert_type(result, bool)

def case_parameter_tuple_ge():
    def compare(value: tuple[Literal[1]]) -> bool:
        return (value, 0) >= ((2,), 1)

def case_parameter_list_ge():
    def compare(value: list[Literal[1]]) -> bool:
        return (value, 0) >= ([2], 1)

def case_custom_direct_lt():
    class Restricted(tuple[Literal[1]]):
        def __lt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    result = (Restricted((1,)), 0) < ((2,), 1)  # ERROR

def case_custom_factory_lt():
    class Restricted(tuple[Literal[1]]):
        def __lt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def make() -> Restricted: return Restricted((1,))
    result = (make(), 0) < ((2,), 1)  # ERROR

def case_custom_parameter_lt():
    class Restricted(tuple[Literal[1]]):
        def __lt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def compare(value: Restricted) -> object:
        return (value, 0) < ((2,), 1)  # ERROR

def case_literal_assignment_lt():
    left: tuple[int, ...] = (1,)
    right: tuple[int, ...] = (2,)
    assert_type(left < right, bool)
    assert_type(left, tuple[Literal[1]])
    target: tuple[Literal[1]] = right  # ERROR

def case_custom_direct_le():
    class Restricted(tuple[Literal[1]]):
        def __le__(self, other: tuple[Literal[1], ...]) -> bool: return True
    result = (Restricted((1,)), 0) <= ((2,), 1)  # ERROR

def case_custom_factory_le():
    class Restricted(tuple[Literal[1]]):
        def __le__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def make() -> Restricted: return Restricted((1,))
    result = (make(), 0) <= ((2,), 1)  # ERROR

def case_custom_parameter_le():
    class Restricted(tuple[Literal[1]]):
        def __le__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def compare(value: Restricted) -> object:
        return (value, 0) <= ((2,), 1)  # ERROR

def case_literal_assignment_le():
    left: tuple[int, ...] = (1,)
    right: tuple[int, ...] = (2,)
    assert_type(left <= right, bool)
    assert_type(left, tuple[Literal[1]])
    target: tuple[Literal[1]] = right  # ERROR

def case_custom_direct_gt():
    class Restricted(tuple[Literal[1]]):
        def __gt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    result = (Restricted((1,)), 0) > ((2,), 1)  # ERROR

def case_custom_factory_gt():
    class Restricted(tuple[Literal[1]]):
        def __gt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def make() -> Restricted: return Restricted((1,))
    result = (make(), 0) > ((2,), 1)  # ERROR

def case_custom_parameter_gt():
    class Restricted(tuple[Literal[1]]):
        def __gt__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def compare(value: Restricted) -> object:
        return (value, 0) > ((2,), 1)  # ERROR

def case_literal_assignment_gt():
    left: tuple[int, ...] = (1,)
    right: tuple[int, ...] = (2,)
    assert_type(left > right, bool)
    assert_type(left, tuple[Literal[1]])
    target: tuple[Literal[1]] = right  # ERROR

def case_custom_direct_ge():
    class Restricted(tuple[Literal[1]]):
        def __ge__(self, other: tuple[Literal[1], ...]) -> bool: return True
    result = (Restricted((1,)), 0) >= ((2,), 1)  # ERROR

def case_custom_factory_ge():
    class Restricted(tuple[Literal[1]]):
        def __ge__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def make() -> Restricted: return Restricted((1,))
    result = (make(), 0) >= ((2,), 1)  # ERROR

def case_custom_parameter_ge():
    class Restricted(tuple[Literal[1]]):
        def __ge__(self, other: tuple[Literal[1], ...]) -> bool: return True
    def compare(value: Restricted) -> object:
        return (value, 0) >= ((2,), 1)  # ERROR

def case_literal_assignment_ge():
    left: tuple[int, ...] = (1,)
    right: tuple[int, ...] = (2,)
    assert_type(left >= right, bool)
    assert_type(left, tuple[Literal[1]])
    target: tuple[Literal[1]] = right  # ERROR
