# This sample tests a case where Type[X] and X are used within the
# same class declaration.

from typing import Dict, Generic, Literal, Type, TypeVar
from dataclasses import dataclass, field

K = TypeVar("K")
V = TypeVar("V")


@dataclass
class Registry(Generic[K, V]):
    key: K
    value: Dict[str, V] = field(default_factory=dict)


class Base:
    pass


BaseType = TypeVar("BaseType", bound=Base)


class BaseTypeRegistry(Registry[Type[BaseType], BaseType]):
    pass


class Thing1(Base):
    pass


t1: Literal["BaseTypeRegistry[Thing1]"] = reveal_type(BaseTypeRegistry(Thing1))

foo: BaseTypeRegistry[Thing1] = BaseTypeRegistry(Thing1)
