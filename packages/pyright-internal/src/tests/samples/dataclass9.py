# This sample verifies that the type analyzer adds
# the __dataclass_fields__ class variable to
# synthesized data classes.

from dataclasses import dataclass
from typing import Any, ClassVar, Protocol


class IsDataclass(Protocol):
    # Checking for this attribute seems to currently be
    # the most reliable way to ascertain that something is a dataclass
    __dataclass_fields__: ClassVar[dict[str, Any]]


def dataclass_only(
    x: IsDataclass,
): ...  # do something that only makes sense with a dataclass


@dataclass
class A:
    pass


dataclass_only(A())
