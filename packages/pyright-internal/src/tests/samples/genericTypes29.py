# This sample tests bidirectional inference when the
# type derives from the expected type and both are
# generic.

from typing import Mapping, Optional, Union

v0: Optional[Mapping[str, Union[int, str]]] = dict([('test1', 1), ('test2', 2)])

v1: Optional[Mapping[str, float]] = dict([('test1', 1), ('test2', 2)])

# This should generate an error because of a type mismatch.
v2: Mapping[str, str] = dict([('test1', 1), ('test2', 2)])
