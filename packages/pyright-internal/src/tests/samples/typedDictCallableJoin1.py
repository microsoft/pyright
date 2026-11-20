from typing import Generic, NotRequired, TypeVar, TypedDict


T = TypeVar("T")


class Box(TypedDict, Generic[T]):
    callback: T
    left: NotRequired[int]
    right: NotRequired[int]


def wrap(callback: T) -> Box[T]:
    return {"callback": callback}


def required(x: int) -> int:
    return x


def optional(x: int = 0) -> int:
    return x


def positional_required(x: int, /) -> int:
    return x


def positional_optional(x: int = 0, /) -> int:
    return x


def keyword_required(*, x: int) -> int:
    return x


def keyword_optional(*, x: int = 0) -> int:
    return x


def standard(flag: bool) -> int:
    safe = wrap(optional)
    if flag:
        value = wrap(required)
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    value["callback"] = required  # This should generate an error.
    return safe["callback"]()


def positional(flag: bool) -> int:
    safe = wrap(positional_optional)
    if flag:
        value = wrap(positional_required)
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    value["callback"] = positional_required  # This should generate an error.
    return safe["callback"]()


def keyword(flag: bool) -> int:
    safe = wrap(keyword_optional)
    if flag:
        value = wrap(keyword_required)
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    value["callback"] = keyword_required  # This should generate an error.
    return safe["callback"]()


def reverse_order(flag: bool) -> int:
    safe = wrap(optional)
    if flag:
        value = safe
        value["left"] = 1
    else:
        value = wrap(required)
        value["right"] = 1
    value["callback"] = required  # This should generate an error.
    return safe["callback"]()


def compatible(flag: bool) -> int:
    safe = wrap(optional)
    if flag:
        value = wrap(required)
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    value["callback"] = optional
    return safe["callback"]()


def nested_box(flag: bool) -> int:
    safe = wrap(wrap(optional))
    if flag:
        value = wrap(wrap(required))
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    reveal_type(value, expected_text="Box[Box[(x: int) -> int]] | Box[Box[(x: int = 0) -> int]]")
    value["callback"] = wrap(required)  # This should generate an error.
    return safe["callback"]["callback"]()


def nested_box_reverse_order(flag: bool) -> int:
    safe = wrap(wrap(optional))
    if flag:
        value = safe
        value["left"] = 1
    else:
        value = wrap(wrap(required))
        value["right"] = 1
    value["callback"] = wrap(required)  # This should generate an error.
    return safe["callback"]["callback"]()


def nested_list(flag: bool) -> int:
    safe = wrap([optional])
    if flag:
        value = wrap([required])
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    reveal_type(value, expected_text="Box[list[(x: int) -> int]] | Box[list[(x: int = 0) -> int]]")
    value["callback"] = [required]  # This should generate an error.
    return safe["callback"][0]()


def nested_compatible(flag: bool) -> int:
    safe = wrap(wrap(optional))
    if flag:
        value = wrap(wrap(required))
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    value["callback"] = wrap(optional)
    return safe["callback"]["callback"]()


U = TypeVar("U")


class Pair(TypedDict, Generic[T, U]):
    first: T
    second: U
    left: NotRequired[int]
    right: NotRequired[int]


def pair(first: T, second: U) -> Pair[T, U]:
    return {"first": first, "second": second}


def second_type_argument(flag: bool) -> int:
    safe = pair(1, optional)
    if flag:
        value = pair(1, required)
        value["left"] = 1
    else:
        value = safe
        value["right"] = 1
    reveal_type(value, expected_text="Pair[int, (x: int) -> int] | Pair[int, (x: int = 0) -> int]")
    value["second"] = required  # This should generate an error.
    return safe["second"]()
