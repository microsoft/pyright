# This sample tests enum literal union equivalence in application and library
# patterns, along with nearby cases that must remain nominal.

import inspect
from collections.abc import Sequence
from enum import Enum, EnumType, Flag, IntEnum, IntFlag, StrEnum
from typing import Final, Literal, Never, assert_never, assert_type


class Route(Enum):
    USERS = "users"
    HEALTH = "health"
    ADMIN = "admin"


RouteLiterals = Literal[Route.USERS, Route.HEALTH, Route.ADMIN]
PartialRouteLiterals = Literal[Route.USERS, Route.HEALTH]
RouteLiteralSuperset = RouteLiterals | Literal["fallback"]


class Priority(IntEnum):
    LOW = 1
    NORMAL = 2
    HIGH = 3


PriorityLiterals = Literal[Priority.LOW, Priority.NORMAL, Priority.HIGH]


class HttpMethod(StrEnum):
    GET = "GET"
    READ = GET
    POST = "POST"
    DELETE = "DELETE"


HttpMethodLiterals = Literal[HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE]


def test_application_enums(
    route: Route,
    literal_route: RouteLiterals,
    priority: Priority,
    literal_priority: PriorityLiterals,
    method: HttpMethod,
    literal_method: HttpMethodLiterals,
) -> None:
    route_literals: RouteLiterals = route
    route_enum: Route = literal_route
    priority_literals: PriorityLiterals = priority
    priority_enum: Priority = literal_priority
    method_literals: HttpMethodLiterals = method
    method_enum: HttpMethod = literal_method

    assert_type(route, RouteLiterals)
    assert_type(literal_route, Route)
    assert_type(priority, PriorityLiterals)
    assert_type(literal_priority, Priority)
    assert_type(method, HttpMethodLiterals)
    assert_type(literal_method, HttpMethod)


def test_optional_and_extra_union_arms(
    optional_route: Route | None,
    optional_literal_route: RouteLiterals | None,
    priority_or_text: Priority | str,
    literal_priority_or_text: PriorityLiterals | str,
) -> None:
    optional1: RouteLiterals | None = optional_route
    optional2: Route | None = optional_literal_route
    extra_arm1: PriorityLiterals | str = priority_or_text
    extra_arm2: Priority | str = literal_priority_or_text

    assert_type(optional_route, RouteLiterals | None)
    assert_type(optional_literal_route, Route | None)
    assert_type(priority_or_text, PriorityLiterals | str)
    assert_type(literal_priority_or_text, Priority | str)


def test_assignment_narrowing() -> None:
    route: Route = Route.USERS
    priority: Priority = Priority.NORMAL
    method: HttpMethod = HttpMethod.READ

    reveal_type(route, expected_text="Literal[Route.USERS]")
    reveal_type(priority, expected_text="Literal[Priority.NORMAL]")
    reveal_type(method, expected_text="Literal[HttpMethod.GET]")


def route_path(route: Route) -> str:
    match route:
        case Route.USERS:
            return "/users"
        case Route.HEALTH:
            return "/health"
        case Route.ADMIN:
            return "/admin"


def priority_weight(priority: Priority) -> int:
    if priority is Priority.LOW:
        return 1
    elif priority is Priority.NORMAL:
        return 5
    else:
        reveal_type(priority, expected_text="Literal[Priority.HIGH]")
        return 10


def method_name(method: HttpMethod) -> str:
    if method is HttpMethod.GET:
        return "read"
    if method is HttpMethod.POST:
        return "create"
    if method is HttpMethod.DELETE:
        return "delete"

    assert_never(method)


class DefaultTimeout(Enum):
    token = -1


DEFAULT_TIMEOUT: Final[DefaultTimeout] = DefaultTimeout.token
Timeout = float | DefaultTimeout | None


def resolve_timeout(value: Timeout, fallback: float) -> float | None:
    # This mirrors the singleton sentinel used by urllib3 and pip.
    if value is DEFAULT_TIMEOUT:
        reveal_type(value, expected_text="Literal[DefaultTimeout.token]")
        return fallback

    reveal_type(value, expected_text="float | None")
    if value is not None and value <= 0:
        return None
    return value


def test_singleton_assignment_narrowing() -> None:
    value: DefaultTimeout = DefaultTimeout.token
    reveal_type(value, expected_text="Literal[DefaultTimeout.token]")


ParameterKinds = Literal[
    inspect.Parameter.POSITIONAL_ONLY,
    inspect.Parameter.POSITIONAL_OR_KEYWORD,
    inspect.Parameter.VAR_POSITIONAL,
    inspect.Parameter.KEYWORD_ONLY,
    inspect.Parameter.VAR_KEYWORD,
]


def replace_parameter_kind(
    parameter: inspect.Parameter, requested: ParameterKinds | None
) -> ParameterKinds:
    # This mirrors discord.py assigning inspect._ParameterKind to its complete
    # public literal alias without a type-ignore comment.
    if requested is None:
        requested = parameter.kind

    assert_type(requested, ParameterKinds)
    assert_type(parameter.kind, ParameterKinds)
    return requested


class Registry[K, V]:
    def __init__(self, values: dict[K, V]) -> None:
        self._values = values

    def register(self, key: K, value: V) -> None:
        self._values[key] = value

    def get(self, key: K) -> V:
        return self._values[key]


ApplicationState = tuple[
    list[dict[Route, tuple[Priority | None, HttpMethod]]],
    Registry[HttpMethod, dict[Route, Priority]],
]
LiteralApplicationState = tuple[
    list[dict[RouteLiterals, tuple[PriorityLiterals | None, HttpMethodLiterals]]],
    Registry[HttpMethodLiterals, dict[RouteLiterals, PriorityLiterals]],
]


def test_invariant_registries(
    enum_registry: Registry[Route, list[Priority | None]],
    literal_registry: Registry[RouteLiterals, list[PriorityLiterals | None]],
    enum_state: ApplicationState,
    literal_state: LiteralApplicationState,
) -> None:
    registry1: Registry[RouteLiterals, list[PriorityLiterals | None]] = enum_registry
    registry2: Registry[Route, list[Priority | None]] = literal_registry
    state1: LiteralApplicationState = enum_state
    state2: ApplicationState = literal_state

    assert_type(
        enum_registry, Registry[RouteLiterals, list[PriorityLiterals | None]]
    )
    assert_type(literal_registry, Registry[Route, list[Priority | None]])
    assert_type(enum_state, LiteralApplicationState)
    assert_type(literal_state, ApplicationState)


class RuntimeValueEnum(Enum):
    FIRST = object()
    SECOND = object()


RuntimeValueLiterals = Literal[RuntimeValueEnum.FIRST, RuntimeValueEnum.SECOND]


def test_statically_known_runtime_values(
    value: RuntimeValueEnum, literal_value: RuntimeValueLiterals
) -> None:
    complete: RuntimeValueLiterals = value
    nominal: RuntimeValueEnum = literal_value
    assert_type(value, RuntimeValueLiterals)


def test_incomplete_and_superset_unions(
    route: Route,
    partial_route: PartialRouteLiterals,
    route_superset: RouteLiteralSuperset,
    routes: list[Route],
    partial_routes: list[PartialRouteLiterals],
    route_supersets: list[RouteLiteralSuperset],
) -> None:
    incomplete: PartialRouteLiterals = route  # This should generate an error
    enum_from_partial: Route = partial_route
    superset: RouteLiteralSuperset = route
    enum_from_superset: Route = route_superset  # This should generate an error

    assert_type(route, PartialRouteLiterals)  # This should generate an error
    assert_type(route, RouteLiteralSuperset)  # This should generate an error

    incomplete_list1: list[PartialRouteLiterals] = routes  # This should generate an error
    incomplete_list2: list[Route] = partial_routes  # This should generate an error
    superset_list1: list[RouteLiteralSuperset] = routes  # This should generate an error
    superset_list2: list[Route] = route_supersets  # This should generate an error


class OtherRoute(Enum):
    USERS = "users"
    HEALTH = "health"
    ADMIN = "admin"


OtherRouteLiterals = Literal[
    OtherRoute.USERS, OtherRoute.HEALTH, OtherRoute.ADMIN
]


def test_unrelated_enums(
    route: Route,
    other_route: OtherRoute,
    routes: list[Route],
    other_routes: list[OtherRouteLiterals],
) -> None:
    other_literals: OtherRouteLiterals = route  # This should generate an error
    route_literals: RouteLiterals = other_route  # This should generate an error
    other_list: list[OtherRouteLiterals] = routes  # This should generate an error
    route_list: list[Route] = other_routes  # This should generate an error


class Feature(Flag):
    SEARCH = 1
    EXPORT = 2


FeatureLiterals = Literal[Feature.SEARCH, Feature.EXPORT]


class FeatureBase(Flag):
    pass


class ExtendedFeature(FeatureBase):
    CHAT = 1
    AUDIT = 2


ExtendedFeatureLiterals = Literal[ExtendedFeature.CHAT, ExtendedFeature.AUDIT]


class Permission(IntFlag):
    READ = 1
    WRITE = 2
    ADMIN = 4


PermissionLiterals = Literal[Permission.READ, Permission.WRITE, Permission.ADMIN]


class PermissionBase(IntFlag):
    pass


class WorkspacePermission(PermissionBase):
    VIEW = 1
    EDIT = 2


WorkspacePermissionLiterals = Literal[
    WorkspacePermission.VIEW, WorkspacePermission.EDIT
]


def test_flag_types_remain_nominal(
    feature: Feature,
    extended: ExtendedFeature,
    permission: Permission,
    workspace_permission: WorkspacePermission,
) -> None:
    feature_members: FeatureLiterals = feature  # This should generate an error
    extended_members: ExtendedFeatureLiterals = extended  # This should generate an error
    permission_members: PermissionLiterals = permission  # This should generate an error
    workspace_members: WorkspacePermissionLiterals = (
        workspace_permission  # This should generate an error
    )


feature_combination = Feature.SEARCH | Feature.EXPORT
extended_combination = ExtendedFeature.CHAT | ExtendedFeature.AUDIT
permission_combination = Permission.READ | Permission.WRITE
workspace_combination = WorkspacePermission.VIEW | WorkspacePermission.EDIT

feature_members: FeatureLiterals = feature_combination  # This should generate an error
extended_members: ExtendedFeatureLiterals = (
    extended_combination  # This should generate an error
)
permission_members: PermissionLiterals = permission_combination  # This should generate an error
workspace_members: WorkspacePermissionLiterals = (
    workspace_combination  # This should generate an error
)


class LibraryEnumType(EnumType):
    pass


class LibraryIntEnum(IntEnum, metaclass=LibraryEnumType):
    pass


class BucketType(LibraryIntEnum):
    DEFAULT = 0
    USER = 1
    CHANNEL = 2


BucketTypeLiterals = Literal[
    BucketType.DEFAULT, BucketType.USER, BucketType.CHANNEL
]


def bucket_key(bucket: BucketType) -> int:
    # This mirrors Steam's exhaustive match over its custom enum hierarchy.
    match bucket:
        case BucketType.DEFAULT:
            return 0
        case BucketType.USER:
            return 1
        case BucketType.CHANNEL:
            return 2


def test_custom_metaclass(
    bucket: BucketType, literal_bucket: BucketTypeLiterals
) -> None:
    members: BucketTypeLiterals = bucket  # This should generate an error
    nominal: BucketType = literal_bucket
    assert_type(bucket, BucketTypeLiterals)  # This should generate an error

    if bucket is BucketType.DEFAULT:
        pass
    elif bucket is BucketType.USER:
        pass
    else:
        reveal_type(bucket, expected_text="Literal[BucketType.CHANNEL]")


def test_custom_metaclass_assignment_narrowing() -> None:
    bucket: BucketType = BucketType.USER
    reveal_type(bucket, expected_text="Literal[BucketType.USER]")


class DynamicPlugin(Enum):
    BUILTIN = "builtin"
    locals()["THIRD_PARTY"] = "third-party"


KnownPluginLiteral = Literal[DynamicPlugin.BUILTIN]


def test_dynamic_members(value: DynamicPlugin) -> None:
    known: KnownPluginLiteral = value  # This should generate an error
    assert_type(value, KnownPluginLiteral)  # This should generate an error

    if value is DynamicPlugin.BUILTIN:
        pass
    else:
        reveal_type(value, expected_text="DynamicPlugin")


def dynamic_plugin_key(value: DynamicPlugin) -> str:  # This should generate an error
    match value:
        case DynamicPlugin.BUILTIN:
            return "builtin"


def assert_known_plugin(value: DynamicPlugin) -> None:
    if value is DynamicPlugin.BUILTIN:
        return

    assert_never(value)  # This should generate an error


class EmptyRoute(Enum):
    pass


def test_empty_enum(value: EmptyRoute) -> None:
    impossible: Never = value  # This should generate an error
    reveal_type(value, expected_text="EmptyRoute")


def optional_identity[T](value: T | None) -> T:
    assert value is not None
    return value


def choose[T](left: T, right: T) -> T:
    return left


def preserve_route[T: Route](value: T) -> T:
    return value


def test_type_var_inference(
    route: Route, literal_route: Literal[Route.USERS]
) -> None:
    reveal_type(optional_identity(route), expected_text="Route")
    reveal_type(choose(route, literal_route), expected_text="Route")
    reveal_type(choose(literal_route, route), expected_text="Route")
    # A bound TypeVar widens an enum literal to its nominal bound.
    reveal_type(preserve_route(literal_route), expected_text="Route")
    reveal_type(preserve_route(route), expected_text="Route")


def test_bound_type_var_invariance[T: Route](
    values: list[T], literal_values: list[RouteLiterals]
) -> None:
    expanded: list[RouteLiterals] = values  # This should generate an error
    narrowed: list[T] = literal_values  # This should generate an error
    assert_type(values, list[T])


def test_variance_boundaries(
    routes: Sequence[Route],
    literal_routes: Sequence[RouteLiterals],
    partial_routes: Sequence[PartialRouteLiterals],
    route_list: list[Route],
    literal_route_list: list[RouteLiterals],
    partial_route_list: list[PartialRouteLiterals],
) -> None:
    complete_covariant1: Sequence[RouteLiterals] = routes
    complete_covariant2: Sequence[Route] = literal_routes
    partial_covariant: Sequence[Route] = partial_routes
    invalid_covariant: Sequence[PartialRouteLiterals] = (
        routes  # This should generate an error
    )

    complete_invariant1: list[RouteLiterals] = route_list
    complete_invariant2: list[Route] = literal_route_list
    invalid_invariant1: list[PartialRouteLiterals] = (
        route_list  # This should generate an error
    )
    invalid_invariant2: list[Route] = partial_route_list  # This should generate an error


def test_registry_invariance_boundaries(
    routes: Registry[Route, int],
    literal_routes: Registry[RouteLiterals, int],
    partial_routes: Registry[PartialRouteLiterals, int],
) -> None:
    complete1: Registry[RouteLiterals, int] = routes
    complete2: Registry[Route, int] = literal_routes
    incomplete1: Registry[PartialRouteLiterals, int] = (
        routes  # This should generate an error
    )
    incomplete2: Registry[Route, int] = partial_routes  # This should generate an error


def test_valid_comparison_before_invalid(
    routes: dict[Route, int],
    literal_routes: dict[RouteLiterals, int],
) -> None:
    complete: dict[RouteLiterals, int] = routes
    identity: dict[Route, int] = routes
    unrelated: dict[OtherRouteLiterals, int] = routes  # This should generate an error
    incomplete: dict[PartialRouteLiterals, int] = routes  # This should generate an error
    reverse: dict[Route, int] = literal_routes
    complete_again: dict[RouteLiterals, int] = routes


def test_invalid_comparison_before_valid(
    routes: dict[Route, int],
    literal_routes: dict[RouteLiterals, int],
) -> None:
    incomplete: dict[PartialRouteLiterals, int] = routes  # This should generate an error
    unrelated: dict[OtherRouteLiterals, int] = routes  # This should generate an error
    identity: dict[Route, int] = routes
    complete: dict[RouteLiterals, int] = routes
    reverse: dict[Route, int] = literal_routes
