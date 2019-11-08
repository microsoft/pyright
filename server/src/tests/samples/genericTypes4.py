# This sample tests type inference and TypeVar matching.

from typing import Union

m = int(1)
n = float(1.1)
p = "hello"

a = dict(x=m, y=m)
a1: int = a["x"]

b = dict(x=n, y=n)
# This should generate an error because b should be
# typed as dict[Any, float], and b["x"] is a float.
b1: int = b["x"]
b2: float = b["x"]

c = dict(x=m, y=n)
# This should generate an error because d should be
# typed as dict[Any, float].
c1: int = c["x"]
c2: float = c["x"]

d = dict(x=p, y=p)
# This should generate an error because d should be
# typed as dict[Any, str].
d1: float = d["x"]
d2: str = d["x"]

e = dict(x=n, y=p)
# This should generate an error because d should be
# typed as dict[Any, str].
e1: str = e["x"]
# This should generate an error because d should be
# typed as dict[Any, str].
e2: float = e["x"]
e3: Union[float, str] = e["x"]
