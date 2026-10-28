# Bounds, constraints and effective metaclasses must use reflected priority.
from types import NotImplementedType
from typing import assert_type


class InstanceBaseLess(object):
    def __lt__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return True


class InstanceTextLess(InstanceBaseLess):
    def __gt__(self, other: object) -> str:
        return "yes"

    def __ge__(self, other: object) -> str:
        return "yes"


class InstanceBooleanLess(InstanceBaseLess):
    def __gt__(self, other: object) -> bool:
        return True

    def __ge__(self, other: object) -> bool:
        return True


class InstanceDecliningLess(InstanceBaseLess):
    def __gt__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __ge__(self, other: object) -> NotImplementedType:
        return NotImplemented

class MetaBaseLess(type):
    def __lt__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return True


class MetaTextLess(MetaBaseLess):
    def __gt__(self, other: object) -> str:
        return "yes"

    def __ge__(self, other: object) -> str:
        return "yes"


class MetaBooleanLess(MetaBaseLess):
    def __gt__(self, other: object) -> bool:
        return True

    def __ge__(self, other: object) -> bool:
        return True


class MetaDecliningLess(MetaBaseLess):
    def __gt__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __ge__(self, other: object) -> NotImplementedType:
        return NotImplemented


class ClassBaseLess(metaclass=MetaBaseLess):
    pass


class ClassTextLess(ClassBaseLess, metaclass=MetaTextLess):
    pass


class ClassBooleanLess(ClassBaseLess, metaclass=MetaBooleanLess):
    pass


class ClassDecliningLess(ClassBaseLess, metaclass=MetaDecliningLess):
    pass


class InstanceTextLess2(InstanceTextLess):
    pass


class InstanceBooleanLess2(InstanceBooleanLess):
    pass


class InstanceDecliningLess2(InstanceDecliningLess):
    pass


class ClassTextLess2(ClassTextLess):
    pass


class ClassBooleanLess2(ClassBooleanLess):
    pass


class ClassDecliningLess2(ClassDecliningLess):
    pass


def compareInstanceBoundTextLess[T: InstanceTextLess](right: T) -> T:
    _ = (InstanceBaseLess(), 0) < (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) < ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseLess(), 0) <= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceBoundBooleanLess[T: InstanceBooleanLess](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


def compareInstanceBoundDecliningLess[T: InstanceDecliningLess](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


def compareInstanceConstraintsTextLess[T: (InstanceTextLess, InstanceTextLess2)](right: T) -> T:
    _ = (InstanceBaseLess(), 0) < (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) < ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseLess(), 0) <= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceConstraintsBooleanLess[T: (InstanceBooleanLess, InstanceBooleanLess2)](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


def compareInstanceConstraintsDecliningLess[T: (InstanceDecliningLess, InstanceDecliningLess2)](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


def compareInstanceUnionTextLess[T: InstanceTextLess | InstanceTextLess2](right: T) -> T:
    _ = (InstanceBaseLess(), 0) < (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) < ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseLess(), 0) <= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceUnionBooleanLess[T: InstanceBooleanLess | InstanceBooleanLess2](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


def compareInstanceUnionDecliningLess[T: InstanceDecliningLess | InstanceDecliningLess2](right: T) -> T:
    assert_type((InstanceBaseLess(), 0) < (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) < ((right,), 1), bool)
    assert_type((InstanceBaseLess(), 0) <= (right, 1), bool)
    assert_type(((InstanceBaseLess(),), 0) <= ((right,), 1), bool)
    return right


class InstancePairLess[L: InstanceBaseLess, R: InstanceTextLess]:
    left: L
    right: R

    def compare(self) -> None:
        _ = (self.left, 0) < (self.right, 1)  # This should generate an error.
        _ = (self.left, 0) <= (self.right, 1)  # This should generate an error.

def compareClassBoundTextLess[T: ClassTextLess](right: type[T]) -> type[T]:
    _ = (ClassBaseLess, 0) < (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) < ((right,), 1)  # This should generate an error.
    _ = (ClassBaseLess, 0) <= (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareClassBoundBooleanLess[T: ClassBooleanLess](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


def compareClassBoundDecliningLess[T: ClassDecliningLess](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


def compareClassConstraintsTextLess[T: (ClassTextLess, ClassTextLess2)](right: type[T]) -> type[T]:
    _ = (ClassBaseLess, 0) < (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) < ((right,), 1)  # This should generate an error.
    _ = (ClassBaseLess, 0) <= (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareClassConstraintsBooleanLess[T: (ClassBooleanLess, ClassBooleanLess2)](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


def compareClassConstraintsDecliningLess[T: (ClassDecliningLess, ClassDecliningLess2)](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


def compareClassUnionTextLess[T: ClassTextLess | ClassTextLess2](right: type[T]) -> type[T]:
    _ = (ClassBaseLess, 0) < (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) < ((right,), 1)  # This should generate an error.
    _ = (ClassBaseLess, 0) <= (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareClassUnionBooleanLess[T: ClassBooleanLess | ClassBooleanLess2](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


def compareClassUnionDecliningLess[T: ClassDecliningLess | ClassDecliningLess2](right: type[T]) -> type[T]:
    assert_type((ClassBaseLess, 0) < (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) < ((right,), 1), bool)
    assert_type((ClassBaseLess, 0) <= (right, 1), bool)
    assert_type(((ClassBaseLess,), 0) <= ((right,), 1), bool)
    return right


class ClassPairLess[L: ClassBaseLess, R: ClassTextLess]:
    left: type[L]
    right: type[R]

    def compare(self) -> None:
        _ = (self.left, 0) < (self.right, 1)  # This should generate an error.
        _ = (self.left, 0) <= (self.right, 1)  # This should generate an error.
class InstanceBaseGreater(object):
    def __gt__(self, other: object) -> bool:
        return True

    def __ge__(self, other: object) -> bool:
        return True


class InstanceTextGreater(InstanceBaseGreater):
    def __lt__(self, other: object) -> str:
        return "yes"

    def __le__(self, other: object) -> str:
        return "yes"


class InstanceBooleanGreater(InstanceBaseGreater):
    def __lt__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return True


class InstanceDecliningGreater(InstanceBaseGreater):
    def __lt__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __le__(self, other: object) -> NotImplementedType:
        return NotImplemented

class MetaBaseGreater(type):
    def __gt__(self, other: object) -> bool:
        return True

    def __ge__(self, other: object) -> bool:
        return True


class MetaTextGreater(MetaBaseGreater):
    def __lt__(self, other: object) -> str:
        return "yes"

    def __le__(self, other: object) -> str:
        return "yes"


class MetaBooleanGreater(MetaBaseGreater):
    def __lt__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return True


class MetaDecliningGreater(MetaBaseGreater):
    def __lt__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __le__(self, other: object) -> NotImplementedType:
        return NotImplemented


class ClassBaseGreater(metaclass=MetaBaseGreater):
    pass


class ClassTextGreater(ClassBaseGreater, metaclass=MetaTextGreater):
    pass


class ClassBooleanGreater(ClassBaseGreater, metaclass=MetaBooleanGreater):
    pass


class ClassDecliningGreater(ClassBaseGreater, metaclass=MetaDecliningGreater):
    pass


class InstanceTextGreater2(InstanceTextGreater):
    pass


class InstanceBooleanGreater2(InstanceBooleanGreater):
    pass


class InstanceDecliningGreater2(InstanceDecliningGreater):
    pass


class ClassTextGreater2(ClassTextGreater):
    pass


class ClassBooleanGreater2(ClassBooleanGreater):
    pass


class ClassDecliningGreater2(ClassDecliningGreater):
    pass


def compareInstanceBoundTextGreater[T: InstanceTextGreater](right: T) -> T:
    _ = (InstanceBaseGreater(), 0) > (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) > ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseGreater(), 0) >= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceBoundBooleanGreater[T: InstanceBooleanGreater](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


def compareInstanceBoundDecliningGreater[T: InstanceDecliningGreater](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


def compareInstanceConstraintsTextGreater[T: (InstanceTextGreater, InstanceTextGreater2)](right: T) -> T:
    _ = (InstanceBaseGreater(), 0) > (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) > ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseGreater(), 0) >= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceConstraintsBooleanGreater[T: (InstanceBooleanGreater, InstanceBooleanGreater2)](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


def compareInstanceConstraintsDecliningGreater[T: (InstanceDecliningGreater, InstanceDecliningGreater2)](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


def compareInstanceUnionTextGreater[T: InstanceTextGreater | InstanceTextGreater2](right: T) -> T:
    _ = (InstanceBaseGreater(), 0) > (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) > ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseGreater(), 0) >= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceUnionBooleanGreater[T: InstanceBooleanGreater | InstanceBooleanGreater2](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


def compareInstanceUnionDecliningGreater[T: InstanceDecliningGreater | InstanceDecliningGreater2](right: T) -> T:
    assert_type((InstanceBaseGreater(), 0) > (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) > ((right,), 1), bool)
    assert_type((InstanceBaseGreater(), 0) >= (right, 1), bool)
    assert_type(((InstanceBaseGreater(),), 0) >= ((right,), 1), bool)
    return right


class InstancePairGreater[L: InstanceBaseGreater, R: InstanceTextGreater]:
    left: L
    right: R

    def compare(self) -> None:
        _ = (self.left, 0) > (self.right, 1)  # This should generate an error.
        _ = (self.left, 0) >= (self.right, 1)  # This should generate an error.

def compareClassBoundTextGreater[T: ClassTextGreater](right: type[T]) -> type[T]:
    _ = (ClassBaseGreater, 0) > (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) > ((right,), 1)  # This should generate an error.
    _ = (ClassBaseGreater, 0) >= (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareClassBoundBooleanGreater[T: ClassBooleanGreater](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


def compareClassBoundDecliningGreater[T: ClassDecliningGreater](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


def compareClassConstraintsTextGreater[T: (ClassTextGreater, ClassTextGreater2)](right: type[T]) -> type[T]:
    _ = (ClassBaseGreater, 0) > (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) > ((right,), 1)  # This should generate an error.
    _ = (ClassBaseGreater, 0) >= (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareClassConstraintsBooleanGreater[T: (ClassBooleanGreater, ClassBooleanGreater2)](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


def compareClassConstraintsDecliningGreater[T: (ClassDecliningGreater, ClassDecliningGreater2)](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


def compareClassUnionTextGreater[T: ClassTextGreater | ClassTextGreater2](right: type[T]) -> type[T]:
    _ = (ClassBaseGreater, 0) > (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) > ((right,), 1)  # This should generate an error.
    _ = (ClassBaseGreater, 0) >= (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareClassUnionBooleanGreater[T: ClassBooleanGreater | ClassBooleanGreater2](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


def compareClassUnionDecliningGreater[T: ClassDecliningGreater | ClassDecliningGreater2](right: type[T]) -> type[T]:
    assert_type((ClassBaseGreater, 0) > (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) > ((right,), 1), bool)
    assert_type((ClassBaseGreater, 0) >= (right, 1), bool)
    assert_type(((ClassBaseGreater,), 0) >= ((right,), 1), bool)
    return right


class ClassPairGreater[L: ClassBaseGreater, R: ClassTextGreater]:
    left: type[L]
    right: type[R]

    def compare(self) -> None:
        _ = (self.left, 0) > (self.right, 1)  # This should generate an error.
        _ = (self.left, 0) >= (self.right, 1)  # This should generate an error.

def compareInstanceMixedUnionLess[T: InstanceTextLess | InstanceBooleanLess](right: T) -> T:
    _ = (InstanceBaseLess(), 0) < (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) < ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseLess(), 0) <= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceMixedConstraintsLess[T: (InstanceTextLess, InstanceBooleanLess)](right: T) -> T:
    _ = (InstanceBaseLess(), 0) < (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) < ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseLess(), 0) <= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseLess(),), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareClassMixedUnionLess[T: ClassTextLess | ClassBooleanLess](right: type[T]) -> type[T]:
    _ = (ClassBaseLess, 0) < (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) < ((right,), 1)  # This should generate an error.
    _ = (ClassBaseLess, 0) <= (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareClassMixedConstraintsLess[T: (ClassTextLess, ClassBooleanLess)](right: type[T]) -> type[T]:
    _ = (ClassBaseLess, 0) < (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) < ((right,), 1)  # This should generate an error.
    _ = (ClassBaseLess, 0) <= (right, 1)  # This should generate an error.
    _ = ((ClassBaseLess,), 0) <= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceMixedUnionGreater[T: InstanceTextGreater | InstanceBooleanGreater](right: T) -> T:
    _ = (InstanceBaseGreater(), 0) > (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) > ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseGreater(), 0) >= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareInstanceMixedConstraintsGreater[T: (InstanceTextGreater, InstanceBooleanGreater)](right: T) -> T:
    _ = (InstanceBaseGreater(), 0) > (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) > ((right,), 1)  # This should generate an error.
    _ = (InstanceBaseGreater(), 0) >= (right, 1)  # This should generate an error.
    _ = ((InstanceBaseGreater(),), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareClassMixedUnionGreater[T: ClassTextGreater | ClassBooleanGreater](right: type[T]) -> type[T]:
    _ = (ClassBaseGreater, 0) > (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) > ((right,), 1)  # This should generate an error.
    _ = (ClassBaseGreater, 0) >= (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) >= ((right,), 1)  # This should generate an error.
    return right


def compareClassMixedConstraintsGreater[T: (ClassTextGreater, ClassBooleanGreater)](right: type[T]) -> type[T]:
    _ = (ClassBaseGreater, 0) > (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) > ((right,), 1)  # This should generate an error.
    _ = (ClassBaseGreater, 0) >= (right, 1)  # This should generate an error.
    _ = ((ClassBaseGreater,), 0) >= ((right,), 1)  # This should generate an error.
    return right
