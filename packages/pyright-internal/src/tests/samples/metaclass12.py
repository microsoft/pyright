# This sample verifies that instance lookup preserves fields installed by a
# custom metaclass without inheriting the built-in type's instance dictionary.

from typing import Any, Literal, Protocol, assert_never


class MetaA(type):
    meta_only = 1

    def __init__(cls, name: str, bases: tuple[type, ...], namespace: dict[str, Any]):
        super().__init__(name, bases, namespace)
        cls.tag: str = "created"
        cls.kind: Literal["left"] = "left"
        cls.__match_args__: tuple[Literal["payload"]] = ("payload",)


class MetaB(type):
    def __init__(cls, name: str, bases: tuple[type, ...], namespace: dict[str, Any]):
        super().__init__(name, bases, namespace)
        cls.kind: Literal["right"] = "right"


class ClassA(int, metaclass=MetaA):
    payload: str = "hello"


class SubclassA(ClassA):
    pass


class ClassB(metaclass=MetaB):
    pass


class Tagged(Protocol):
    tag: str


def read_tag(value: Tagged) -> str:
    return value.tag


reveal_type(read_tag(ClassA), expected_text="str")
reveal_type(ClassA.meta_only, expected_text="int")
reveal_type(ClassA.__dict__, expected_text="MappingProxyType[str, Any]")

# This should generate an error because the class dictionary is read-only.
ClassA.__dict__["payload"] = "hello"


def func1(value: ClassA, derived: SubclassA):
    reveal_type(value.tag, expected_text="str")
    reveal_type(read_tag(value), expected_text="str")
    reveal_type(read_tag(derived), expected_text="str")
    reveal_type(value.__dict__, expected_text="dict[str, Any]")
    value.__dict__["payload"] = "hello"

    # This should generate an error because the attribute belongs only to the metaclass.
    value.meta_only


def func2(value: ClassA):
    match value:
        case ClassA("hello"):
            reveal_type(value, expected_text="ClassA")


def func3(value: ClassA | ClassB):
    reveal_type(value.kind, expected_text="Literal['left', 'right']")
    if value.kind == "left":
        reveal_type(value, expected_text="ClassA")
    elif value.kind == "right":
        reveal_type(value, expected_text="ClassB")
    else:
        assert_never(value)


class FieldInstaller:
    def install(self) -> None:
        self.tag: str = "installed"


# FieldInstaller follows type in the metaclass MRO.
class MetaC(type, FieldInstaller):
    def __init__(cls, name: str, bases: tuple[type, ...], namespace: dict[str, Any]):
        super().__init__(name, bases, namespace)
        cls.install()


class ClassC(metaclass=MetaC):
    pass


class SubclassC(ClassC):
    pass


def func4(value: ClassC, derived: SubclassC):
    reveal_type(ClassC.tag, expected_text="str")
    reveal_type(value.tag, expected_text="str")
    reveal_type(derived.tag, expected_text="str")
    reveal_type(read_tag(value), expected_text="str")
    reveal_type(read_tag(derived), expected_text="str")
    reveal_type(value.__dict__, expected_text="dict[str, Any]")
    value.__dict__["tag"] = "updated"


class GenericClass[T](metaclass=MetaA):
    pass


def func5(value: GenericClass[int], class_object: type[GenericClass[int]], metaclass_instance: MetaA):
    reveal_type(value.__type_params__, expected_text="tuple[TypeVar | ParamSpec | TypeVarTuple, ...]")
    reveal_type(class_object.__type_params__, expected_text="tuple[TypeVar | ParamSpec | TypeVarTuple, ...]")
    reveal_type(value.__dict__, expected_text="dict[str, Any]")
    reveal_type(class_object.__dict__, expected_text="MappingProxyType[str, Any]")
    reveal_type(metaclass_instance.__dict__, expected_text="MappingProxyType[str, Any]")
