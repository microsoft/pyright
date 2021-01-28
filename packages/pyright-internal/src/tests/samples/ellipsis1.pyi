# This sample tests cases where the ellipsis operator can
# and cannot be used.

from typing import Any, Callable, Dict, Generic, Optional, Tuple, TypeVar, Union

_T1 = TypeVar("_T1")

class MyGenericClass1(Generic[_T1]):
    pass

# This should generate two errors because ... cannot be used
# in a Generic list and it's not a type variable.
class MyGenericClass2(Generic[_T1, ...]):
    pass

MyGenericClass1[int]

# This should generate an error because ... cannot be used
# in a specialization list.
MyGenericClass1[...]

a: Tuple[int, ...]

# This should generate an error because ... cannot be used
# in this context.
b: Tuple[..., int]

c: Callable[..., Any]

# This should generate an error because ... cannot be used
# in this context.
d: Callable[[...], Any]

# This should generate an error because ... cannot be used
# in this context.
e: Callable[[], ...]

# This should generate two errors because ... cannot be used
# in this context.
f: Dict[..., ...]

# This should generate an error because ... cannot be used
# in this context.
g: Union[int, str, ...]

# This should generate an error because ... cannot be used
# in this context.
h: Optional[...]
