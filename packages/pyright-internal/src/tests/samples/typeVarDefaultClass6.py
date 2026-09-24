# This sample tests realistic registries and factories that store class objects
# for subclasses that retain defaulted type parameters.

from ctypes import py_object
from typing import Any, Generic, TypeAlias, assert_type, reveal_type

from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]


class Response:
    pass


class JsonResponse(Response):
    pass


class TextResponse(Response):
    pass


class UserContext:
    pass


ContextT = TypeVar("ContextT")
ResponseT = TypeVar("ResponseT", default=JsonResponse)
CovariantResponseT = TypeVar("CovariantResponseT", covariant=True, default=JsonResponse)
TagT = TypeVar("TagT")
RowT = TypeVar("RowT")
DefaultRowT = TypeVar("DefaultRowT", covariant=True, default=tuple[Any, ...])
CTypesT = TypeVar("CTypesT")


class Handler(Generic[ContextT, ResponseT]):
    def __init__(self, response: ResponseT | None = None):
        self.response = response


class UserHandler(Handler[UserContext, ResponseT]):
    pass


class AuditedUserHandler(UserHandler[ResponseT]):
    pass


class Tagged(Generic[TagT]):
    pass


class CachedUserHandler(AuditedUserHandler[ResponseT], Tagged[str]):
    pass


valid_handler: type[UserHandler[JsonResponse]] = UserHandler

# This should generate an error because the retained default is JsonResponse.
invalid_handler: type[UserHandler[TextResponse]] = UserHandler

valid_base_handler: type[Handler[UserContext, JsonResponse]] = CachedUserHandler

# This should generate an error through the multi-level subclass chain.
invalid_base_handler: type[Handler[UserContext, TextResponse]] = CachedUserHandler

valid_tagged_handler: type[Tagged[str]] = CachedUserHandler


class HandlerRegistry:
    default_handler: type[UserHandler[JsonResponse]] = UserHandler
    audited_handlers: tuple[
        type[UserHandler[JsonResponse]],
        type[UserHandler[JsonResponse]],
    ] = (AuditedUserHandler, CachedUserHandler)

    # This should generate an error for a registry with the wrong specialization.
    text_handler: type[UserHandler[TextResponse]] = UserHandler


DefaultUserHandler: TypeAlias = UserHandler[JsonResponse]
DefaultUserHandlerFactory: TypeAlias = type[DefaultUserHandler]

aliased_factory: DefaultUserHandlerFactory = UserHandler
explicit_factory: type[UserHandler[TextResponse]] = UserHandler[TextResponse]

# This should generate an error for an explicitly specialized class object.
invalid_aliased_factory: DefaultUserHandlerFactory = UserHandler[TextResponse]

assert_type(UserHandler(), UserHandler[JsonResponse])
assert_type(UserHandler(TextResponse()), UserHandler[TextResponse])
assert_type(UserHandler[TextResponse](TextResponse()), UserHandler[TextResponse])


class Plugin(Generic[ContextT, ResponseT]):
    pass


class FrameworkPlugin(Plugin[ContextT, ResponseT]):
    pass


# The leading non-defaulted parameter keeps a bare partially-defaulted class
# unspecialized, so explicit destination arguments remain usable.
partial_default: type[FrameworkPlugin[int, JsonResponse]] = FrameworkPlugin
partial_override: type[FrameworkPlugin[str, TextResponse]] = FrameworkPlugin
reveal_type(FrameworkPlugin, expected_text="type[FrameworkPlugin[Unknown, JsonResponse]]")


def infer_plugin_context(
    cls: type[FrameworkPlugin[ContextT, JsonResponse]],
    context: ContextT,
) -> ContextT:
    raise NotImplementedError


assert_type(infer_plugin_context(FrameworkPlugin, 1), int)


class InvariantService(Generic[ResponseT]):
    pass


invariant_exact: type[InvariantService[JsonResponse]] = InvariantService

# This should generate an error because ResponseT is invariant.
invariant_wider: type[InvariantService[Response]] = InvariantService


class CovariantService(Generic[CovariantResponseT]):
    pass


covariant_exact: type[CovariantService[JsonResponse]] = CovariantService
covariant_wider: type[CovariantService[Response]] = CovariantService

# This should generate an error because JsonResponse is not a TextResponse.
covariant_unrelated: type[CovariantService[TextResponse]] = CovariantService


class Cursor(Generic[DefaultRowT]):
    pass


class Connection(Generic[RowT]):
    cursor_factory: type[Cursor[RowT]]

    def __init__(self):
        # This should generate an error because bare Cursor uses tuple[Any, ...],
        # which is not compatible with every possible RowT.
        self.cursor_factory = Cursor


tuple_cursor: type[Cursor[tuple[Any, ...]]] = Cursor
object_cursor: type[Cursor[object]] = Cursor

# This should generate an error because the nested default remains concrete.
int_cursor: type[Cursor[int]] = Cursor

assert_type(Cursor(), Cursor[tuple[Any, ...]])
assert_type(Cursor[int](), Cursor[int])


def infer_ctypes_value(cls: type[py_object[CTypesT]], value: CTypesT) -> CTypesT:
    raise NotImplementedError


# py_object defaults directly to Any, so the bare class must remain gradual.
ctypes_int: type[py_object[int]] = py_object
ctypes_str: type[py_object[str]] = py_object
assert_type(infer_ctypes_value(py_object, 1), int)
