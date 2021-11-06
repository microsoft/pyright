# This sample tests bidirectional inference when the
# type derives from the expected type and both are
# generic.

from typing import Iterable, Mapping, Optional, TypeVar, Union

v0: Optional[Mapping[str, Union[int, str]]] = dict([("test1", 1), ("test2", 2)])

v1: Optional[Mapping[str, float]] = dict([("test1", 1), ("test2", 2)])

# This should generate an error because of a type mismatch.
v2: Mapping[str, str] = dict([("test1", 1), ("test2", 2)])


options: dict[Union[int, str], int] = {}
channel_types: dict[str, int] = {}

keys = channel_types.keys()

_T = TypeVar("_T")
_S = TypeVar("_S")


options.update(dict.fromkeys(keys, 1))
