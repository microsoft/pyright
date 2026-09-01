# This sample tests TypeForm in realistic schema and serializer APIs while
# ensuring ordinary runtime expressions remain outside TypeForm evaluation.

# pyright: reportMissingModuleSource=false

from collections.abc import Callable
from types import GenericAlias, UnionType
from typing import (
    Annotated,
    Any,
    ClassVar,
    Concatenate,
    Final,
    Literal,
    NamedTuple,
    ParamSpec,
    Self,
    TypedDict,
    TypeVarTuple,
    Unpack,
    assert_type,
)
from typing_extensions import Sentinel, TypeForm


class Codec[T]:
    def encode(self, value: T) -> bytes:
        raise NotImplementedError

    def decode(self, payload: bytes) -> T:
        raise NotImplementedError


def codec_for[T](schema: TypeForm[T]) -> Codec[T]:
    raise NotImplementedError


def serializer[T](schema: TypeForm[T]) -> Callable[[Callable[[T], bytes]], Callable[[T], bytes]]:
    def decorate(func: Callable[[T], bytes]) -> Callable[[T], bytes]:
        return func

    return decorate


class User(TypedDict):
    id: int
    name: str


type UserId = Annotated[int, "user-id"]
type UserBatch = list[User]

user_codec = codec_for(User)
assert_type(user_codec, Codec[User])

forward_user_codec = codec_for("User")
assert_type(forward_user_codec, Codec[User])

optional_user_codec = codec_for("User | None")
assert_type(optional_user_codec, Codec[User | None])

batch_codec = codec_for(UserBatch)
assert_type(batch_codec, Codec[list[User]])

annotated_codec = codec_for(Annotated[UserId, "wire"])
assert_type(annotated_codec, Codec[int])

nested_codec = codec_for("dict[str, list[User]]")
assert_type(nested_codec, Codec[dict[str, list[User]]])

schema_registry: dict[str, list[TypeForm[Any]]] = {
    "users": [User, "User | None", list[User]],
    "ids": [UserId, "list[UserId]"],
}


@serializer("User")
def dump_user(value: User) -> bytes:
    return str(value).encode()


assert_type(dump_user, Callable[[User], bytes])


def runtime_decorator[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    return func


@runtime_decorator
def user_label(value: User) -> str:
    return value["name"]


assert_type(user_label({"id": 1, "name": "Ada"}), str)


# The same expressions retain their ordinary runtime types outside TypeForm contexts.
runtime_generic_alias: GenericAlias = list[User]
runtime_union_type: UnionType = User | None
typed_generic_alias: TypeForm[list[User]] = list[User]
typed_union_type: TypeForm[User | None] = User | None


class Resource:
    @classmethod
    def codec(cls) -> Codec[Self]:
        return codec_for(Self)


assert_type(Resource.codec(), Codec[Resource])


def middleware_codec[**P, R](
    handler: Callable[P, R],
) -> Codec[Callable[Concatenate[str, P], R]]:
    return codec_for(Callable[Concatenate[str, P], R])


def tuple_codec[*Ts](values: tuple[*Ts]) -> Codec[tuple[*Ts]]:
    return codec_for(tuple[Unpack[Ts]])


MISSING = Sentinel("MISSING")
missing_codec = codec_for(MISSING)
assert_type(missing_codec, Codec[MISSING])

optional_missing_codec = codec_for(int | MISSING)
assert_type(optional_missing_codec, Codec[int | MISSING])

literal_codec = codec_for(Literal["int", "list[str]"])
assert_type(literal_codec, Codec[Literal["int", "list[str]"]])


# A PEP 695 type alias used as a nested TypeForm argument should resolve
# to the alias's target type rather than the runtime TypeAliasType.
type Foo = int | str


class Bar[T: Foo]: ...


bar_codec = codec_for(Bar[Foo])
assert_type(bar_codec, Codec[Bar[Foo]])


# Mixed contexts preserve valid non-TypeForm alternatives.
def accept_string_or_type(value: str | TypeForm[int]) -> None:
    pass


accept_string_or_type("not a type")
accept_string_or_type(int)
mixed_registry: list[str | TypeForm[int]] = ["not a type", int]


# Ordinary strings, Literal values, calls, and NamedTuple field names stay runtime-scoped.
ordinary_names = ["int", "list[str]"]
assert_type(ordinary_names, list[str])

ordinary_literal: Literal["int"] = "int"
assert_type(ordinary_literal, Literal["int"])

Pair = NamedTuple("Pair", [("name", str), ("value", int)])
pair = Pair("count", 1)
assert_type(pair.name, str)
assert_type(pair.value, int)


P = ParamSpec("P")
Ts = TypeVarTuple("Ts")
literal_value = "int"


def make_user() -> User:
    return {"id": 1, "name": "Ada"}


# These should each generate an error because the argument is not a valid type expression.
bad_string = codec_for("not a type")
bad_expression = codec_for(1 + 2)
bad_call = codec_for(make_user())
bad_class_var = codec_for(ClassVar[int])
bad_final = codec_for(Final[int])
bad_param_spec = codec_for(P)
bad_type_var_tuple = codec_for(Ts)
bad_unpack = codec_for(Unpack[Ts])
bad_literal_variable = codec_for(Literal[literal_value])
bad_literal_f_string = codec_for(Literal[f"{literal_value}"])
