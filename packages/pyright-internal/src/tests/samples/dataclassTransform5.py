# This sample tests the case where a dataclass inherits a dataclass
# behavior (like kw_only) from its parent class.

from typing import dataclass_transform


@dataclass_transform()
class ModelMeta(type):
    pass


class ModelBase(metaclass=ModelMeta):
    def __init_subclass__(cls, kw_only: bool = False) -> None:
        pass


class Base(ModelBase, kw_only=True):
    pass


class Model(Base):
    a: str | None = None
    b: int


Model(b=0)

# This should generate an error because of kw_only.
Model("", 1)
