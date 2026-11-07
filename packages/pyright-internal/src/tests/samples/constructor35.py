# This sample checks class-local constructor and method aliases.

from typing import Generic, Never, TypeVar, assert_type, overload


class BaseClass:
    pass


class DemoSerializer(BaseClass):
    def __init_impl(
        self,
        registry_client: str,
        schema_str: str,
        conf: dict[str, object] | None = None,
    ) -> None:
        self.registry_client = registry_client
        self.schema_str = schema_str
        self.conf = conf or {}

    __init__ = __init_impl


DemoSerializer(registry_client="registry", schema_str="schema", conf={"key": "value"})
DemoSerializer(registry_client="registry", schema_str="schema")
DemoSerializer("registry", "schema")
reveal_type(
    DemoSerializer.__init__,
    expected_text="(self: DemoSerializer, registry_client: str, schema_str: str, conf: dict[str, object] | None = None) -> None",
)

# This should generate an error because schema_str is required.
DemoSerializer("registry")

# This should generate an error because registry_client must be a string.
DemoSerializer(123, "schema")

# This should generate an error because unexpected is not a parameter.
DemoSerializer("registry", "schema", unexpected=True)


class Base:
    @overload
    def __init__(self, value: int) -> None: ...
    @overload
    def __init__(self, value: str) -> None: ...
    def __init__(self, value: int | str) -> None: ...


class Derived(Base):
    @overload
    def impl(self, text: bytes) -> None: ...
    @overload
    def impl(self, text: list[str]) -> None: ...
    def impl(self, text: bytes | list[str]) -> None: ...

    __init__ = impl


class Inherited(Derived):
    pass


Derived(b"value")
Derived(["value"])
Inherited(text=b"value")
Inherited(["value"])

T = TypeVar("T")


class Box(Generic[T]):
    def impl(self, value: T) -> None:
        self.value = value

    __init__ = impl


assert_type(Box(1), Box[int])
assert_type(Box("value").value, str)


class NewBase:
    def __new__(cls, value: int) -> "NewBase":
        return object.__new__(cls)


class NewDerived(NewBase):
    @staticmethod
    def impl(class_type: type["NewDerived"], text: str) -> "NewDerived":
        return object.__new__(class_type)

    __new__ = impl


assert_type(NewDerived(text="value"), NewDerived)
reveal_type(NewDerived, expected_text="type[NewDerived]")

# This should generate an error because text is required.
NewDerived()

# This should generate an error because text must be a string.
NewDerived(text=1)


def make(class_type: type["ModuleAlias"], text: str) -> "ModuleAlias":
    return object.__new__(class_type)


class ModuleAlias:
    __new__ = make


assert_type(ModuleAlias(text="value"), ModuleAlias)


class ReturnsBase(NewBase):
    @staticmethod
    def impl(class_type: type["ReturnsBase"], text: str) -> NewBase:
        return object.__new__(NewBase)

    __new__ = impl

    def __init__(self, value: int) -> None: ...


assert_type(ReturnsBase(text="value"), NewBase)


class SubclassBase:
    def __init_subclass__(cls, value: int) -> None: ...


class SubclassDerived(SubclassBase, value=1):
    @classmethod
    def impl(cls, text: str) -> None: ...

    __init_subclass__ = impl


class Child(SubclassDerived, text="value"):
    pass


class PostBase:
    def __post_init__(self, value: int) -> None: ...


class PostDerived(PostBase):
    def impl(self, text: str) -> None: ...

    __post_init__ = impl


PostDerived().__post_init__(text="value")


class MethodBase:
    def method(self, value: int) -> object:
        return value

    def __call__(self, value: int) -> object:
        return value

    def __getitem__(self, value: int) -> object:
        return value


class MethodDerived(MethodBase):
    def impl(self, value: int) -> str:
        return str(value)

    method = impl
    __call__ = impl
    __getitem__ = impl


assert_type(MethodDerived().method(1), str)
assert_type(MethodDerived()(1), str)
assert_type(MethodDerived()[1], str)


class Invalid:
    @staticmethod
    def impl(value: str) -> "Invalid":
        return object.__new__(Invalid)

    __new__ = impl


# This should generate an error because __new__ receives a class, not a string.
Invalid()


class NeverCreated:
    @staticmethod
    def impl(class_type: type["NeverCreated"], text: str) -> Never:
        raise RuntimeError(text)

    __new__ = impl


assert_type(NeverCreated(text="value"), Never)
