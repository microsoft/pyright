# This sample tests a case where Type[X] and X are used within the
# same class declaration.

from typing import Generic, TypeVar
from dataclasses import dataclass, field

K = TypeVar("K")
V = TypeVar("V")


@dataclass
class Registry(Generic[K, V]):
    key: K
    value: dict[str, V] = field(default_factory=dict)


class Base:
    pass


BaseType = TypeVar("BaseType", bound=Base)


class BaseTypeRegistry(Registry[type[BaseType], BaseType]):
    pass


class Thing1(Base):
    pass


reveal_type(BaseTypeRegistry(Thing1), expected_text="BaseTypeRegistry[Thing1]")

foo: BaseTypeRegistry[Thing1] = BaseTypeRegistry(Thing1)
