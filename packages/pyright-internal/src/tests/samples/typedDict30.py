from typing import TypedDict, Unpack, assert_type


class AwesomeDict(TypedDict, total=False):
    foo: int
    bar: int
    baz: int


def consume_a(arg: str, **kw: Unpack[AwesomeDict]):
    pass


def get_bool() -> bool:
    raise NotImplementedError


a: AwesomeDict = {}
if get_bool():
    a = {"foo": 2, "bar": 3}
else:
    a = {"foo": 3, "baz": 4}

assert_type(a, AwesomeDict)
consume_a("hi", **a)
