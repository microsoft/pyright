# This sample tests the "transform_descriptor_types" parameter of a
# dataclass_transform.

from typing import Any, Callable, Generic, overload, Tuple, TypeVar, Union

T = TypeVar("T")


def __dataclass_transform__(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    transform_descriptor_types: bool = False,
    field_descriptors: Tuple[Union[type, Callable[..., Any]], ...] = (()),
) -> Callable[[T], T]:
    return lambda a: a


def mapped_field(
    *,
    default: Any,
) -> Any:
    ...


class Descriptor(Generic[T]):
    def __get__(self, instance: object, owner: Any) -> T:
        ...

    def __set__(self, instance: object, value: T) -> None:
        ...


@__dataclass_transform__(
    transform_descriptor_types=True, field_descriptors=(mapped_field,)
)
class ModelBaseDescriptorTransform:
    ...


class UserModel1(ModelBaseDescriptorTransform):
    name: Descriptor[str]
    age: Descriptor[int | None] = mapped_field(default=None)


reveal_type(
    UserModel1.__init__,
    expected_text="(self: UserModel1, name: str, age: int | None = None) -> None",
)

um1 = UserModel1(name="hi", age=1)


@__dataclass_transform__(
    transform_descriptor_types=False, field_descriptors=(mapped_field,)
)
class ModelBaseNoDescriptorTransform:
    ...


class UserModel2(ModelBaseNoDescriptorTransform):
    name: Descriptor[str]


reveal_type(
    UserModel2.__init__,
    expected_text="(self: UserModel2, name: Descriptor[str]) -> None",
)

# This should generate an error because "hi" is not a descriptor instance.
um2 = UserModel2(name="hi")


class OverloadedDescriptor(Generic[T]):
    def __get__(self, instance: object, owner: Any) -> T:
        ...

    @overload
    def __set__(self, instance: Any, value: T) -> None:
        ...

    @overload
    def __set__(self, instance: Any, value: float) -> None:
        ...

    def __set__(self, instance, value: T | float):
        ...


class UserModel3(ModelBaseDescriptorTransform):
    name: OverloadedDescriptor[str]


reveal_type(
    UserModel3.__init__,
    expected_text="(self: UserModel3, name: str | float) -> None",
)

um3 = UserModel3(name="hi")
