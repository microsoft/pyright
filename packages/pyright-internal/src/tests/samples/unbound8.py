# This sample tests class-local name resolution when bindings are unreachable.

token = "global"


def class_local_before_read():
    class Nested:
        if False:
            token = 0
        value = token
        reveal_type(token, expected_text="str")

    return Nested.value.upper()
    token = 123


def class_local_after_read():
    class Nested:
        value = token
        reveal_type(token, expected_text="str")
        if False:
            token = 0

    return Nested.value.upper()
    token = 123


def class_local_with_instance_member():
    class Nested:
        if False:
            token = 0

        def __init__(self):
            self.token = 1

        value = token
        reveal_type(token, expected_text="str")

    reveal_type(Nested().token, expected_text="int")
    return Nested.value.upper()
    token = 123


def class_free_variable():
    class Nested:
        # This should generate an error; without a class-local binding,
        # the read captures the uninitialized outer cell.
        value = token

    return Nested
    token = 123


class Base:
    token: str = "base"


class Derived(Base):
    if False:
        token = 0
        __eq__ = None


reveal_type(Derived().token, expected_text="str")
reveal_type(Derived().__hash__, expected_text="() -> int")


class WithGetattr:
    if False:
        missing = 0

    def __getattr__(self, name: str) -> str:
        return "fallback"


reveal_type(WithGetattr().missing, expected_text="str")


def class_initialized_local():
    class Nested:
        if False:
            token = 0
        token = "class"
        value = token
        reveal_type(token, expected_text="str")

    return Nested.value.upper()
    token = 123


def class_nonlocal():
    token = "outer"

    class Nested:
        if False:
            nonlocal token
            token = 0
        value = token

    return Nested.value.upper()


def class_global():
    class Nested:
        if False:
            global token
            token = 0
        value = token
        reveal_type(token, expected_text="str")

    return Nested.value.upper()
    token = 123


def forward_class_nonlocal():
    class Nested:
        if False:
            nonlocal value
            value = "dead"

    value = 1
    return value


def separate_dead_nonlocal():
    value = 1

    class Nested:
        if False:
            nonlocal value
        if False:
            value = "dead"
        result = value
        reveal_type(value, expected_text="Literal[1]")

    return Nested.result


T = int


class GenericDeadLocal[T]:
    if False:
        T = str
    value = T
    type Alias = T


reveal_type(GenericDeadLocal.value, expected_text="type[int]")


def uses_generic_alias(value: GenericDeadLocal[int].Alias):
    reveal_type(value, expected_text="int")
