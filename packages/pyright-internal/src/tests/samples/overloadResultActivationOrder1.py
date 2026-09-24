from typing import Any, Sequence, TypeVar, overload

T = TypeVar("T")

@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value

@overload
def choose_other(value: list[bytes]) -> list[bytes]: ...
@overload
def choose_other(value: list[float]) -> list[float]: ...
def choose_other(value: Any) -> Any:
    return value

def project(value: list[T]) -> Sequence[T]:
    return value

@overload
def unwrap(value: Sequence[int]) -> int: ...
@overload
def unwrap(value: Sequence[str]) -> str: ...
def unwrap(value: Any) -> Any:
    return value[0]

@overload
def unwrap_other(value: Sequence[bytes]) -> bytes: ...
@overload
def unwrap_other(value: Sequence[float]) -> float: ...
def unwrap_other(value: Any) -> Any:
    return value[0]

def positive(value: list[Any], other: list[Any], concrete: list[int]):
    first = choose(value)
    first_alias = first
    first_projected = project(first_alias)
    first_scalar = unwrap(first_projected)
    first_scalar.upper()
    first_scalar.bit_length()
    first_int: list[int] = first
    first_str: list[str] = first
    first.append(1)
    first.append("ok")

    between: int = "bad"
    first_invalid: list[bytes] = first

    second = choose_other(other)
    second_alias = second
    second_projected = project(second_alias)
    second_scalar = unwrap_other(second_projected)
    second_scalar.decode()
    second_scalar.hex()
    second_bytes: list[bytes] = second
    second_float: list[float] = second
    second.append(b"ok")
    second.append(1.0)

    first_scalar.upper()
    first_scalar.bit_length()
    # No single alternative accepts the whole iterable.
    first.extend([1, "x"])
    second.extend([b"x", 1.0])
    first.append(3.14)
    second.append("neither")
    first.nonexistent()
    second.nonexistent()

    bad_producer: list[bytes] = choose(value)
    ordinary = choose(concrete)
    ordinary.append("bad")

def independent(value: list[Any]):
    remote = choose_other(value)
    remote.append(b"ok")
    remote.append(1.0)

def declined(value: list[Any]):
    escaped = choose(value)
    escaped.append("not_supported")
    return escaped
