# repetitive_identifiers.py — stresses the tokenizer's identifier intern
# cache by using a small set of identifiers (self, cls, T, K, V, str, int,
# list, dict, None, True, False, etc.) thousands of times. Tokenizing this
# file should hit the identifier intern cache on the vast majority of
# identifier tokens.

from typing import Any, Dict, Generic, List, Optional, Tuple, TypeVar, Union

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")


class C1(Generic[T, K, V]):
    def __init__(self, x: T, y: K, z: V) -> None:
        self.x = x
        self.y = y
        self.z = z

    def get_x(self) -> T:
        return self.x

    def get_y(self) -> K:
        return self.y

    def get_z(self) -> V:
        return self.z

    def set_x(self, x: T) -> None:
        self.x = x

    def set_y(self, y: K) -> None:
        self.y = y

    def set_z(self, z: V) -> None:
        self.z = z

    def swap(self, other: "C1[T, K, V]") -> None:
        self.x, other.x = other.x, self.x
        self.y, other.y = other.y, self.y
        self.z, other.z = other.z, self.z

    @classmethod
    def make(cls, x: T, y: K, z: V) -> "C1[T, K, V]":
        return cls(x, y, z)

    @classmethod
    def pair(cls, x: T, y: K, z: V) -> Tuple["C1[T, K, V]", "C1[T, K, V]"]:
        return cls(x, y, z), cls(x, y, z)


class C2(Generic[T, K, V]):
    def __init__(self, x: T, y: K, z: V) -> None:
        self.x = x
        self.y = y
        self.z = z

    def get_x(self) -> T:
        return self.x

    def get_y(self) -> K:
        return self.y

    def get_z(self) -> V:
        return self.z

    def set_x(self, x: T) -> None:
        self.x = x

    def set_y(self, y: K) -> None:
        self.y = y

    def set_z(self, z: V) -> None:
        self.z = z

    @classmethod
    def make(cls, x: T, y: K, z: V) -> "C2[T, K, V]":
        return cls(x, y, z)


def f1(x: int, y: int, z: int) -> int:
    return x + y + z


def f2(x: int, y: int, z: int) -> int:
    return x + y + z


def f3(x: int, y: int, z: int) -> int:
    return x + y + z


def f4(x: int, y: int, z: int) -> int:
    return x + y + z


def f5(x: int, y: int, z: int) -> int:
    return x + y + z


def build_list(x: int, y: int, z: int) -> List[int]:
    return [x, y, z, x, y, z, x, y, z, x, y, z, x, y, z, x, y, z, x, y, z, x, y, z]


def build_dict(x: str, y: str, z: str) -> Dict[str, str]:
    return {"x": x, "y": y, "z": z, "a": x, "b": y, "c": z, "d": x, "e": y, "f": z}


def build_tuple(x: int, y: int, z: int) -> Tuple[int, int, int, int, int, int]:
    return (x, y, z, x, y, z)


def deep(x: int, y: int, z: int) -> Optional[int]:
    if x is None:
        return None
    if y is None:
        return None
    if z is None:
        return None
    if x == 0:
        return x
    if y == 0:
        return y
    if z == 0:
        return z
    return x + y + z


def union_of(x: Union[int, str], y: Union[int, str], z: Union[int, str]) -> Union[int, str]:
    if isinstance(x, int) and isinstance(y, int) and isinstance(z, int):
        return x + y + z
    return str(x) + str(y) + str(z)


def any_of(x: Any, y: Any, z: Any) -> Any:
    return x or y or z or x or y or z or x or y or z


# Lots of calls, each one touches the same identifiers repeatedly.
_ = f1(1, 2, 3)
_ = f2(1, 2, 3)
_ = f3(1, 2, 3)
_ = f4(1, 2, 3)
_ = f5(1, 2, 3)
_ = f1(1, 2, 3)
_ = f2(1, 2, 3)
_ = f3(1, 2, 3)
_ = f4(1, 2, 3)
_ = f5(1, 2, 3)
_ = f1(1, 2, 3)
_ = f2(1, 2, 3)
_ = f3(1, 2, 3)
_ = f4(1, 2, 3)
_ = f5(1, 2, 3)

_ = build_list(1, 2, 3)
_ = build_list(1, 2, 3)
_ = build_list(1, 2, 3)
_ = build_list(1, 2, 3)
_ = build_list(1, 2, 3)

_ = build_dict("a", "b", "c")
_ = build_dict("a", "b", "c")
_ = build_dict("a", "b", "c")
_ = build_dict("a", "b", "c")
_ = build_dict("a", "b", "c")

_ = build_tuple(1, 2, 3)
_ = build_tuple(1, 2, 3)
_ = build_tuple(1, 2, 3)
_ = build_tuple(1, 2, 3)
_ = build_tuple(1, 2, 3)

_ = deep(1, 2, 3)
_ = deep(1, 2, 3)
_ = deep(1, 2, 3)
_ = deep(1, 2, 3)
_ = deep(1, 2, 3)

_ = union_of(1, 2, 3)
_ = union_of(1, 2, 3)
_ = union_of(1, 2, 3)
_ = union_of(1, 2, 3)
_ = union_of(1, 2, 3)

_ = any_of(1, 2, 3)
_ = any_of(1, 2, 3)
_ = any_of(1, 2, 3)
_ = any_of(1, 2, 3)
_ = any_of(1, 2, 3)

c1 = C1(1, "a", [1, 2, 3])
c2 = C1(1, "a", [1, 2, 3])
c3 = C1(1, "a", [1, 2, 3])
c4 = C1(1, "a", [1, 2, 3])
c5 = C1(1, "a", [1, 2, 3])
c6 = C2(1, "a", [1, 2, 3])
c7 = C2(1, "a", [1, 2, 3])
c8 = C2(1, "a", [1, 2, 3])
c9 = C2(1, "a", [1, 2, 3])
c10 = C2(1, "a", [1, 2, 3])

# Flat attribute-access cascade — each line references self-like receivers
# multiple times, producing many repeated identifier tokens per line.
r1 = c1.get_x() + c2.get_x() + c3.get_x() + c4.get_x() + c5.get_x()
r2 = c1.get_y() + c2.get_y() + c3.get_y() + c4.get_y() + c5.get_y()
r3 = c1.get_z() + c2.get_z() + c3.get_z() + c4.get_z() + c5.get_z()
r4 = c6.get_x() + c7.get_x() + c8.get_x() + c9.get_x() + c10.get_x()
r5 = c6.get_y() + c7.get_y() + c8.get_y() + c9.get_y() + c10.get_y()
r6 = c6.get_z() + c7.get_z() + c8.get_z() + c9.get_z() + c10.get_z()

# A batch of nearly-identical lines to really hammer the intern cache.
v1 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v2 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v3 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v4 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v5 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v6 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v7 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v8 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v9 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]
v10 = [x for x in [1, 2, 3, 4, 5, 6, 7, 8, 9] if x > 0 and x < 10 and x != 5]

w1 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w2 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w3 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w4 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w5 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w6 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w7 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w8 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w9 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
w10 = {k: v for k, v in [("a", 1), ("b", 2), ("c", 3)] if v > 0 and k != "x"}
