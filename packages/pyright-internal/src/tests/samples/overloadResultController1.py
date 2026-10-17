from typing import Any, Sequence, TypeVar, overload, assert_type, reveal_type

T = TypeVar("T")

@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value

def project(value: list[T]) -> Sequence[T]:
    return value

@overload
def unwrap(value: Sequence[int]) -> int: ...
@overload
def unwrap(value: Sequence[str]) -> str: ...
def unwrap(value: Any) -> Any:
    return value[0]

def positive(value: list[Any], plain: Sequence[Any], condition: bool):
    ret = choose(value)
    alias = ret
    projected = project(alias)
    scalar = unwrap(projected)
    ret.append("x")
    scalar.upper()
    scalar.bit_length()
    integer: list[int] = ret
    string: list[str] = ret
    string.append("x")
    string.append(1)
    bad: list[bytes] = ret
    ret.append(3.14)
    ret.nonexistent()
    adjacent: int = "bad"
    unwrap(project(ret) if condition else plain).upper()
    unwrap(plain if condition else project(ret)).upper()
    reveal_type(alias)
    assert_type(alias, list[int])
    assert_type(alias, list[Any])
    print(integer, string, bad, adjacent)
    ret = [b"new"]
    alias.append("old")
    ret.append(1)

def repeated(value: list[Any]):
    ret = choose(value)
    ret.append("early")
    print(ret, ret)
    independent = choose(value)
    independent.append("ok")

def escaped(value: list[Any]):
    ret = choose(value)
    ret.append("early")
    alias = ret
    storage = [alias]
    print(storage)

def captured(value: list[Any]):
    ret = choose(value)
    ret.append("early")
    def closure():
        ret.append("inner")
    closure()

def joined(value: list[Any], condition: bool):
    ret = choose(value)
    ret.append("early")
    if condition:
        ret = [b"new"]
    ret.append("late")

def returned(value: list[Any]):
    ret = choose(value)
    ret.append("early")
    return ret

class Box:
    field: list[int]

def attribute(value: list[Any], box: Box):
    ret = choose(value)
    ret.append("early")
    box.field = ret

def distinct(value: list[Any]):
    ret = choose(value)
    ret.append("early")
    second = choose(value)
    print(ret, second)

def concrete(value: list[str]):
    ret = value
    ret.append(1)
    ret.nonexistent()

def gradual(value: list[Any]):
    ret = value
    ret.append(1)
    ret.nonexistent()

def unknown(value: list):
    ret = value
    ret.append("ordinary")
    ret.nonexistent()

def failed(value: list[Any]):
    ret = choose(missing_producer)
    ret.append("x")
