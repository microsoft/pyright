from typing import Any, Generic, Sequence, TypeVar, assert_type, overload, reveal_type

T = TypeVar("T")

@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value

def original(value: list[Any]):
    ret = choose(value)
    alias = ret
    integer: list[int] = alias
    string: list[str] = alias
    ret.append(1)
    ret.append("x")
    ret.append(3.14)
    ret.nonexistent()
    invalid: list[bytes] = ret
    unrelated: int = "bad"
    reveal_type(alias)
    assert_type(alias, list[int])
    assert_type(1, ret)
    print(integer, string, invalid, unrelated)

@overload
def covered(value: list[int]) -> list[int]: ...
@overload
def covered(value: list[Any]) -> list[Any]: ...
@overload
def covered(value: list[str]) -> list[str]: ...
def covered(value: Any) -> Any:
    return value

def prefix(value: list[Any]):
    ret = covered(value)
    ret.append("x")

@overload
def equivalent(value: list[int]) -> list[int]: ...
@overload
def equivalent(value: list[str]) -> list[int]: ...
def equivalent(value: Any) -> list[int]:
    return []

def equal_returns(value: list[Any]):
    ret = equivalent(value)
    ret.append("x")

@overload
def defaults(value: list[int], second: int = 0) -> list[int]: ...
@overload
def defaults(value: list[str], second: int = 0) -> list[str]: ...
def defaults(value: Any, second: int = 0) -> Any:
    return value

def default_argument(value: list[Any]):
    ret = defaults(value)
    ret.append("x")

@overload
def generic(value: list[T]) -> list[T]: ...
@overload
def generic(value: Sequence[T]) -> list[T]: ...
def generic(value: Sequence[T]) -> list[T]:
    return list(value)

def type_variable(value: list[Any]):
    ret = generic(value)
    ret.nonexistent()

@overload
def unsupported(value: list[int]) -> list[int]: ...
@overload
def unsupported(value: Sequence[str]) -> list[str]: ...
def unsupported(value: Any) -> Any:
    return value

def unsupported_proof(value: list[Any]):
    ret = unsupported(value)
    ret.append("x")

@overload
def arity(value: list[int], second: int) -> list[int]: ...
@overload
def arity(value: list[str]) -> list[str]: ...
def arity(value: Any, second: int = 0) -> Any:
    return value

def one_mapping(value: list[Any]):
    ret = arity(value)
    ret.append(1)

@overload
def nested(value: list[list[int]]) -> list[list[int]]: ...
@overload
def nested(value: list[list[str]]) -> list[list[str]]: ...
def nested(value: Any) -> Any:
    return value

def nested_invariant(value: list[list[Any]]):
    ret = nested(value)
    integer: list[list[int]] = ret
    string: list[list[str]] = ret
    print(integer, string)

def concrete(value: list[str]):
    ret = choose(value)
    ret.append(1)

def unknown(value: list):
    ret = choose(value)
    ret.append("x")

def any_argument(value: Any):
    ret = choose(value)
    ret.nonexistent()

def union_argument(value: list[int] | list[str]):
    ret = choose(value)
    ret.append("x")

def keywords(value: list[Any]):
    ret = choose(value=value)
    ret.append("x")

def unpack(value: tuple[list[Any]]):
    ret = choose(*value)
    ret.append("x")

class Receiver:
    @overload
    def method(self, value: list[int]) -> list[int]: ...
    @overload
    def method(self, value: list[str]) -> list[str]: ...
    def method(self, value: Any) -> Any:
        return value

def receiver(value: list[Any], obj: Receiver):
    ret = obj.method(value)
    ret.append("x")
    other = Receiver.method(obj, value)
    other.append("x")

def early(value: list[Any]):
    ret = choose(value)
    ret.append("x")
    container = [ret]
    print(container)

def independent(value: list[Any]):
    ret = choose(value)
    ret.append("x")

class Invariant(Generic[T]):
    pass

@overload
def nominal(value: Invariant[int]) -> Invariant[int]: ...
@overload
def nominal(value: Invariant[str]) -> Invariant[str]: ...
def nominal(value: Any) -> Any:
    return value

def custom_nominal(value: Invariant[Any]):
    ret = nominal(value)
    integer: Invariant[int] = ret
    string: Invariant[str] = ret
    print(integer, string)
