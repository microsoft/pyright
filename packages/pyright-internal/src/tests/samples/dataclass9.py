# This sample verifies that the type analyzer adds
# the __dataclass_fields__ class variable to
# synthesized data classes.

from dataclasses import dataclass
from typing import Any, Dict, Protocol


class IsDataclass(Protocol):
    # checking for this attribute seems to currently be
    # the most reliable way to ascertain that something is a dataclass
    __dataclass_fields__: Dict[str, Any]

def dataclass_only(x: IsDataclass):
    ...  # do something that only makes sense with a dataclass

@dataclass
class A:
    pass

dataclass_only(A())
