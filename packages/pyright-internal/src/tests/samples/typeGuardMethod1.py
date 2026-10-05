# This sample tests TypeGuard and TypeIs narrowing for bound, unbound,
# static, class, overloaded, callable-instance, reordered keyword, and
# module-qualified function calls.

from typing import Callable, ClassVar, Concatenate, Literal, Protocol, TypeGuard, TypeIs, Unpack, overload
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


def test_multiple_overloads_used_for_mapping(x: object, y: object, mode: Literal[0, 1]):
    if check_mode(x, y, mode):
        reveal_type(x, expected_text="str | int")
        reveal_type(y, expected_text="object")
    else:
        reveal_type(x, expected_text="object")
        reveal_type(y, expected_text="object")


def test_ambiguous_overload_mapping(x: object, y: object, mode: Literal[0, 1]):
    # The overloads guard different arguments when passed by keyword.
    if check_mode(a=x, b=y, mode=mode):
        reveal_type(x, expected_text="object")
        reveal_type(y, expected_text="object")
    else:
        reveal_type(x, expected_text="object")
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


class StringPredicate:
    def __call__(self, value: object, context: object) -> TypeGuard[str]:
        return isinstance(value, str)


class IntegerPredicate:
    def __call__(self, value: object, context: object) -> TypeIs[int]:
        return isinstance(value, int)


class Registry:
    text: ClassVar[Callable[[object, object], TypeGuard[str]]] = StringPredicate()
    integer: ClassVar[Callable[[object, object], TypeIs[int]]] = IntegerPredicate()
    concrete: ClassVar[StringPredicate] = StringPredicate()


def test_class_callable_guard(x: object, y: object):
    if Registry.text(x, y):
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")
        x.upper()
    else:
        reveal_type(x, expected_text="object")
        reveal_type(y, expected_text="object")


def test_class_callable_typeis(x: int | str, y: int | str):
    if Registry.integer(x, y):
        reveal_type(x, expected_text="int")
        reveal_type(y, expected_text="int | str")
    else:
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="int | str")


def test_class_callable_context(x: object, y: object):
    if Registry.text(x, y):
        # This should generate an error: the predicate checks x, not y.
        y.upper()


def test_class_callable_typeis_context(x: int | str, y: object):
    if Registry.integer(x, y):
        # This should generate an error: the predicate checks x, not y.
        y.bit_length()


def test_class_callable_alias(x: object, y: object):
    check = Registry.text
    if check(x, y):
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")


def test_concrete_class_callable(x: object, y: object):
    if Registry.concrete(context=y, value=x):
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")


def test_unbound_alias_positional(c: Checker, x: object, a: int | str):
    guard = Checker.is_str
    if guard(c, x):
        reveal_type(c, expected_text="Checker")
        reveal_type(x, expected_text="str")
    else:
        reveal_type(c, expected_text="Checker")
        reveal_type(x, expected_text="object")

    narrower = Checker.is_int
    if narrower(c, a):
        reveal_type(c, expected_text="Checker")
        reveal_type(a, expected_text="int")
    else:
        reveal_type(c, expected_text="Checker")
        reveal_type(a, expected_text="str")


def test_unbound_alias_keyword(c: Checker, x: object, a: int | str):
    guard = Checker.is_str
    if guard(val=x, self=c):
        reveal_type(x, expected_text="str")
        reveal_type(c, expected_text="Checker")
        x.upper()
    else:
        reveal_type(x, expected_text="object")
        reveal_type(c, expected_text="Checker")

    narrower = Checker.is_int
    if narrower(val=a, self=c):
        reveal_type(a, expected_text="int")
        reveal_type(c, expected_text="Checker")
    else:
        reveal_type(a, expected_text="str")
        reveal_type(c, expected_text="Checker")


def test_bound_aliases(c: Checker, x: object, a: int | str):
    guard = c.is_str
    if guard(val=x):
        reveal_type(x, expected_text="str")
        reveal_type(c, expected_text="Checker")

    narrower = c.is_int
    if narrower(val=a):
        reveal_type(a, expected_text="int")
    else:
        reveal_type(a, expected_text="str")


def test_class_and_static_aliases(x: object, a: bool | str):
    guard = Checker.is_float
    if guard(x):
        reveal_type(x, expected_text="float")

    narrower = Checker.is_bool
    if narrower(val=a):
        reveal_type(a, expected_text="bool")
    else:
        reveal_type(a, expected_text="str")


def test_gradual_callable_guard(check: Callable[..., TypeGuard[str]], x: object, y: object) -> str | None:
    if check(x, context=y):
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")
        return x
    else:
        reveal_type(x, expected_text="object")
        reveal_type(y, expected_text="object")
    return None


def test_gradual_callable_typeis(check: Callable[..., TypeIs[int]], x: int | str, y: object):
    if check(x, context=y):
        reveal_type(x, expected_text="int")
        reveal_type(y, expected_text="object")
    else:
        reveal_type(x, expected_text="str")
        reveal_type(y, expected_text="object")
        x.upper()


def test_gradual_callable_prefix(check: Callable[Concatenate[object, ...], TypeGuard[str]], x: object):
    if check(x, 0):
        reveal_type(x, expected_text="str")


def test_expanded_callable_guard(check: Callable[[Unpack[tuple[object, int]]], TypeGuard[str]], x: object):
    if check(x, 0):
        reveal_type(x, expected_text="str")
        x.upper()
    else:
        reveal_type(x, expected_text="object")


def test_expanded_callable_typeis(check: Callable[[Unpack[tuple[object, int]]], TypeIs[int]], x: int | str):
    if check(x, 0):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")
        x.upper()


def test_expanded_callable_tail(check: Callable[[object, Unpack[tuple[int]]], TypeGuard[str]], x: object):
    if check(x, 0):
        reveal_type(x, expected_text="str")


def test_callable_unpacking(check: Callable[..., TypeGuard[str]], x: object):
    if check(x, *(0,)):
        reveal_type(x, expected_text="str")


def test_ambiguous_callable_unpacking(check: Callable[..., TypeGuard[str]], x: object):
    if check(*(0,), x):
        reveal_type(x, expected_text="object")


def test_variadic_callable_guard(check: Callable[[Unpack[tuple[object, ...]]], TypeGuard[str]], x: object):
    if check(x, 0):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_variadic_callable_typeis(check: Callable[[Unpack[tuple[object, ...]]], TypeIs[int]], x: int | str):
    if check(x, 0):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


class VariadicGuard(Protocol):
    def __call__(self, *values: object) -> TypeGuard[str]: ...


class VariadicTypeIs(Protocol):
    def __call__(self, *values: object) -> TypeIs[int]: ...


def test_variadic_protocol_guard(check: VariadicGuard, x: object):
    if check(x, 0):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_variadic_protocol_typeis(check: VariadicTypeIs, x: int | str):
    if check(x, 0):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


def variadic_guard(*values: object) -> TypeGuard[str]:
    return isinstance(values[0], str)


def variadic_typeis(*values: object) -> TypeIs[int]:
    return isinstance(values[0], int)


def test_variadic_function_guard(x: object):
    if variadic_guard(x, 0):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_variadic_function_typeis(x: int | str):
    if variadic_typeis(x, 0):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


class SeparatedChecker:
    def is_str(self, /, value: object) -> TypeGuard[str]:
        return isinstance(value, str)

    def is_int(self, *, value: object) -> TypeGuard[int]:
        return isinstance(value, int)


def test_separated_receiver_alias(c: SeparatedChecker, x: object, y: object):
    check = SeparatedChecker.is_str
    if check(c, x):
        reveal_type(c, expected_text="SeparatedChecker")
        reveal_type(x, expected_text="str")

    if check(c, value=y):
        reveal_type(c, expected_text="SeparatedChecker")
        reveal_type(y, expected_text="str")


def test_keyword_only_guard(c: SeparatedChecker, x: object):
    check = c.is_int
    if check(value=x):
        reveal_type(c, expected_text="SeparatedChecker")
        reveal_type(x, expected_text="int")
