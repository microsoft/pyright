# This sample tests that the check that validates the operand type for
# a conditional statement. The operand must be of type bool or a type
# that has a __bool__ method that returns a bool.

from typing import Never, NoReturn, TypeVar


class ReturnsBool:
    def __bool__(self) -> bool:
        return True


class ReturnsNonBool:
    def __bool__(self) -> NoReturn:
        raise TypeError("Not a bool")


def func1(val: ReturnsNonBool):
    # This should generate an error.
    if val:
        pass

    # This should generate an error.
    a = not val

    b = val or 1
    # This should generate an error.
    if b:
        pass

    c = 1 and val
    # This should generate an error.
    if c:
        pass

    # This should generate an error.
    y = 1 if val else 2

    # This should generate an error.
    while val:
        break

    # This should generate an error.
    z = [1 for i in range(10) if val]


TVal = TypeVar("TVal", bound=ReturnsNonBool)


def func2(val: TVal | ReturnsBool) -> TVal | ReturnsBool:
    # This should generate an error.
    if val:
        pass

    # This should generate an error.
    a = not val

    b = val or 1
    # This should generate an error.
    if b:
        pass

    c = 1 and val
    # This should generate an error.
    if c:
        pass

    # This should generate an error.
    y = 1 if val else 2

    # This should generate an error.
    while val:
        break

    # This should generate an error.
    z = [1 for i in range(10) if val]

    return val


class Meta(type):
    def __bool__(self) -> int:
        return 1


class MetaDerived(metaclass=Meta):
    pass


def func3(val: type[MetaDerived]):
    # This should generate an error.
    if val:
        pass


TBool = TypeVar("TBool", bound=bool)


def func4(value: TBool) -> TBool:
    class DisabledBool:
        __bool__ = None

        def __len__(self) -> int:
            return 1

    class RequiresArgument:
        def __bool__(self, x: int) -> bool:
            return x > 0

    class InvalidBinding:
        __bool__ = lambda: True

    class RequiresArgumentMeta(type):
        def __bool__(cls, x: int) -> bool:
            return x > 0

    class WithMeta(metaclass=RequiresArgumentMeta):
        pass

    class TypeConstructor:
        __bool__ = type

    class NonBoolReturn:
        def __bool__(self) -> bool | int:
            return 1

    class BoolConstructor:
        __bool__ = bool

    class BoundedReturn:
        def __bool__(self) -> TBool:
            return value

    class NeverMember:
        __bool__: Never

    class InstanceMember:
        def __init__(self):
            self.__bool__ = None

    # This should generate an error: a defined __bool__ prevents the __len__ fallback.
    if DisabledBool():
        pass
    # This should generate an error for the required argument.
    if RequiresArgument():
        pass
    # This should generate an error because the function cannot bind self.
    if InvalidBinding():
        pass
    # This should generate an error for the metaclass's required argument.
    if WithMeta:
        pass
    # This should generate an error because type() requires arguments.
    if TypeConstructor():
        pass
    # This should generate an error because int is not assignable to bool.
    if NonBoolReturn():
        pass

    if BoolConstructor():
        pass
    if BoundedReturn():
        pass
    if NeverMember():
        pass
    if InstanceMember():
        pass

    return value
