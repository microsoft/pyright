# This sample covers KW_ONLY annotations that must not hide genuine
# uninitialized instance variables in final subclasses.

from abc import ABC
from dataclasses import KW_ONLY, dataclass, field
from typing import final


# A KW_ONLY separator does not replace an inherited field requiring initialization.
# This should generate an uninitialized-instance-variable error.
@dataclass
class Root(ABC):
    _: int = field(init=False)


@dataclass
class Middle(Root):
    _: KW_ONLY


@final
class Leaf(Middle):
    pass


# A locally shadowed KW_ONLY name is an ordinary annotation, not a separator.
# This should generate an uninitialized-instance-variable error.
def check_shadowed_kw_only() -> None:
    class KW_ONLY:
        pass

    @dataclass(init=False)
    class Base(ABC):
        marker: KW_ONLY

    @final
    class Final(Base):
        pass


# A real separator remains exempt from the uninitialized-variable check.
@dataclass
class GenuineSeparator(ABC):
    _: KW_ONLY


@final
class FinalWithSeparator(GenuineSeparator):
    pass
