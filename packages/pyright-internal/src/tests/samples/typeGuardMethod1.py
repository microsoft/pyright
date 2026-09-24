# This sample tests TypeGuard and TypeIs narrowing for bound, unbound,
# static, class, overloaded, callable-instance, reordered keyword, and
# module-qualified function calls.

from typing import Any, Callable, Literal, TypeGuard, TypeIs, overload
import typeGuard1


class Checker:
    def is_str(self, val: object) -> TypeGuard[str]:
        return isinstance(val, str)

    def is_int(self, val: object) -> TypeIs[int]:
        return isinstance(val, int)

    @staticmethod
    def is_float(val: object) -> TypeGuard[float]:
        return isinstance(val, float)

    @classmethod
    def is_bytes(cls, val: object) -> TypeGuard[bytes]:
        return isinstance(val, bytes)

    @classmethod
    def is_bool(cls, val: object) -> TypeIs[bool]:
        return isinstance(val, bool)


def test_bound_method(c: Checker, x: object):
    if c.is_str(x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_bound_method_keyword(c: Checker, x: object):
    if c.is_str(val=x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_bound_method_typeis(c: Checker, x: int | str):
    if c.is_int(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


def test_unbound_method(c: Checker, x: object):
    if Checker.is_str(c, x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_unbound_method_keyword(c: Checker, x: object):
    if Checker.is_str(val=x, self=c):
        reveal_type(x, expected_text="str")
        reveal_type(c, expected_text="Checker")
    else:
        reveal_type(x, expected_text="object")
        reveal_type(c, expected_text="Checker")


def test_unbound_method_typeis(c: Checker, x: int | str):
    if Checker.is_int(c, x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


def test_static_method(x: object):
    if Checker.is_float(x):
        reveal_type(x, expected_text="float")
    else:
        reveal_type(x, expected_text="object")


def test_module_qualified_free_function(a: tuple[int, ...]):
    if typeGuard1.is_two_element_tuple(a):
        reveal_type(a, expected_text="tuple[int, int]")
    else:
        reveal_type(a, expected_text="tuple[int, ...]")


def test_class_method_via_instance(c: Checker, x: object):
    if c.is_bytes(x):
        reveal_type(x, expected_text="bytes")
    else:
        reveal_type(x, expected_text="object")


def test_class_method_via_class(x: object):
    if Checker.is_bytes(x):
        reveal_type(x, expected_text="bytes")
    else:
        reveal_type(x, expected_text="object")


def test_class_method_keyword(x: object):
    if Checker.is_bytes(val=x):
        reveal_type(x, expected_text="bytes")
    else:
        reveal_type(x, expected_text="object")


def test_class_method_typeis(x: bool | str):
    if Checker.is_bool(x):
        reveal_type(x, expected_text="bool")
    else:
        reveal_type(x, expected_text="str")


class OverloadedCallable:
    @overload
    def __call__(self, other: int, extra: int, /) -> bool: ...
    @overload
    def __call__(self, val: object) -> TypeGuard[str]: ...
    def __call__(self, val: object, extra: int | None = None) -> bool | TypeGuard[str]:
        return isinstance(val, str)


def test_overloaded_callable_instance(f: OverloadedCallable, x: object):
    if f(x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


@overload
def is_str_overloaded(other: int, extra: int, /) -> bool: ...
@overload
def is_str_overloaded(val: object) -> TypeGuard[str]: ...
def is_str_overloaded(val: object, extra: int | None = None) -> bool | TypeGuard[str]:
    return isinstance(val, str)


def test_overloaded_function_keyword(x: object):
    # The first (non-guard) overload uses a different parameter name, so the
    # guard-returning overload must be the one used for argument mapping.
    if is_str_overloaded(val=x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_overloaded_function_positional(x: object):
    if is_str_overloaded(x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def is_str_pos_only(value: object, /, **options: object) -> TypeGuard[str]:
    return isinstance(value, str)


def is_int_pos_only(value: object, /, **options: object) -> TypeIs[int]:
    return isinstance(value, int)


def test_positional_only_with_kwargs(x: object, y: object, a: int | str, b: int | str):
    # The keyword argument "value" is captured by **options, not by the
    # positional-only guarded parameter.
    if is_str_pos_only(x, value=y):
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")

    if is_int_pos_only(a, value=b):
        reveal_type(a, expected_text="int")
        reveal_type(b, expected_text="int | str")
    else:
        reveal_type(a, expected_text="str")
        reveal_type(b, expected_text="int | str")


@overload
def check_mode(a: object, b: object, mode: Literal[0]) -> TypeGuard[str]: ...
@overload
def check_mode(b: object, a: object, mode: Literal[1]) -> TypeGuard[int]: ...
def check_mode(*args: object, **kwargs: object) -> bool:
    return True


def test_overload_used_for_mapping(x: object, y: object):
    # The second overload is the one selected for the call, so its first
    # parameter ("b") determines the guarded argument.
    if check_mode(x, a=y, mode=1):
        reveal_type(x, expected_text="int")
        reveal_type(y, expected_text="object")


def plain_is_str(val: object) -> TypeGuard[str]:
    return isinstance(val, str)


class PropertyGuard:
    @property
    def __call__(self) -> Callable[[object], TypeGuard[str]]:
        return plain_is_str


class InferredGuard:
    def __call__(self, value: object):
        return Checker.is_float(value)


def test_property_call(guard: PropertyGuard, value: object):
    if guard(value):
        reveal_type(value, expected_text="str")


def test_inferred_call(guard: InferredGuard, value: object):
    if guard(value):
        reveal_type(value, expected_text="float")
