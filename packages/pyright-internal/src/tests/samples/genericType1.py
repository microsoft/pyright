# This sample tests bidirectional type inference and constraint solving.

m = int(1)
n = float(1.1)
p = "hello"

a = dict(x=m, y=m)
a1: int = a["x"]

b = dict(x=n, y=n)
reveal_type(b, expected_text="dict[str, float]")

# This should generate an error.
b1: int = b["x"]
b2: float = b["x"]

c = dict(x=m, y=n)
reveal_type(c, expected_text="dict[str, float]")

# This should generate an error.
c1: int = c["x"]
c2: float = c["x"]

d = dict(x=p, y=p)
reveal_type(d, expected_text="dict[str, str]")

# This should generate an error.
d1: float = d["x"]
d2: str = d["x"]

e = dict(x=n, y=p)
reveal_type(e, expected_text="dict[str, float | str]")

# This should generate an error.
e1: str = e["x"]
# This should generate an error.
e2: float = e["x"]
e3: float | str = e["x"]
