# This sample tests that recursive constructor annotations do not cause
# unbounded recursion when validating a constructor call.


class RecursiveInit:
    __init__: type["RecursiveInit"]


reveal_type(RecursiveInit(), expected_text="RecursiveInit")


class RecursiveNew:
    __new__: type["RecursiveNew"]


RecursiveNew()


class Meta(type):
    # This should generate an error: __call__ is incompatible with type.__call__.
    __call__: type["RecursiveCall"]


class RecursiveCall(metaclass=Meta): ...


RecursiveCall()


class First:
    __new__: type["Second"]


class Second:
    __new__: type[First]


First()


# Nonrecursive class-valued constructor methods must still be evaluated.
class Other:
    def __init__(self, value: int): ...


class Nonrecursive:
    __init__: type[Other]


reveal_type(Nonrecursive(1), expected_text="Nonrecursive")
# This should generate an error: the nonrecursive constructor requires an int.
Nonrecursive("bad")


# A nested call at a different expression must not be mistaken for a cycle.
class Nested:
    def __init__(self, value: "Nested | None" = None): ...


reveal_type(Nested(Nested()), expected_text="Nested")
