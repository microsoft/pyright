# This sample tests realistic applications and counterexamples for solving
# repeated TypeVarTuples from heterogeneous arguments.

from typing import Any, Callable, Generic, Literal, Never, TypeVar, TypeVarTuple, overload

Ts = TypeVarTuple("Ts")
R = TypeVar("R")


class Dimension:
    pass


class StaticDimension(Dimension):
    pass


class BatchDimension(Dimension):
    pass


class Tensor(Generic[*Ts]):
    @property
    def shape(self) -> tuple[*Ts]:
        raise NotImplementedError


def broadcast_shape(left: tuple[*Ts], right: tuple[*Ts]) -> tuple[*Ts]:
    raise NotImplementedError


def check_tensor_shapes(
    image: Tensor[BatchDimension, StaticDimension],
    dynamic: Tensor[BatchDimension, Dimension],
):
    shape = broadcast_shape(image.shape, dynamic.shape)
    reveal_type(shape, expected_text="tuple[BatchDimension, Dimension]")


class UserId:
    pass


class LegacyUserId:
    pass


class Payload:
    pass


class EncodedPayload:
    pass


def zip_record_types(left: tuple[*Ts], right: tuple[*Ts]) -> tuple[*Ts]:
    raise NotImplementedError


def check_zipped_records(
    left: tuple[UserId, Payload],
    right: tuple[LegacyUserId, EncodedPayload],
):
    row = zip_record_types(left, right)
    reveal_type(row, expected_text="tuple[UserId | LegacyUserId, Payload | EncodedPayload]")


def check_different_lengths(
    short: tuple[UserId],
    long: tuple[UserId, Payload],
):
    # This should generate an error because the tuple lengths differ.
    zip_record_types(short, long)


class FirstA:
    pass


class FirstB:
    pass


class FirstC:
    pass


class SecondA:
    pass


class SecondB:
    pass


class SecondC:
    pass


def merge_rows(*rows: tuple[*Ts]) -> tuple[*Ts]:
    raise NotImplementedError


def check_repeated_rows(
    first: tuple[FirstA, SecondA],
    second: tuple[FirstB, SecondB],
    third: tuple[FirstC, SecondC],
):
    row = merge_rows(first, second, third)
    reveal_type(row, expected_text="tuple[FirstA | FirstB | FirstC, SecondA | SecondB | SecondC]")


literal_row = zip_record_types((1, "left"), (2, "right"))
reveal_type(literal_row, expected_text="tuple[int, str]")


class Base:
    pass


class Sub(Base):
    pass


def parser_base() -> tuple[Base, UserId]:
    raise NotImplementedError


def parser_sub() -> tuple[Sub, LegacyUserId]:
    raise NotImplementedError


def combine_parsers(
    left: Callable[[], tuple[*Ts]],
    right: Callable[[], tuple[*Ts]],
) -> tuple[*Ts]:
    raise NotImplementedError


parser_result = combine_parsers(parser_base, parser_sub)
reveal_type(parser_result, expected_text="tuple[Base, UserId | LegacyUserId]")


def parser_short() -> tuple[UserId]:
    raise NotImplementedError


def parser_long() -> tuple[UserId, Payload]:
    raise NotImplementedError


# This should generate an error because covariance must not erase a length mismatch.
combine_parsers(parser_short, parser_long)


def parse_objects(identifier: object, payload: object) -> str:
    return ""


def parse_exact(identifier: UserId, payload: Payload) -> str:
    return ""


def run_examples(
    callback: Callable[[*Ts], R],
    first: tuple[*Ts],
    second: tuple[*Ts],
) -> tuple[R, tuple[*Ts]]:
    raise NotImplementedError


example_result = run_examples(
    parse_objects,
    (UserId(), Payload()),
    (LegacyUserId(), EncodedPayload()),
)
reveal_type(
    example_result,
    expected_text="tuple[str, tuple[UserId | LegacyUserId, Payload | EncodedPayload]]",
)


# This should generate an error because parse_exact cannot consume the widened row.
run_examples(
    parse_exact,
    (UserId(), Payload()),
    (LegacyUserId(), EncodedPayload()),
)


def merge_consumers(
    left: Callable[[*Ts], None],
    right: Callable[[*Ts], None],
) -> tuple[*Ts]:
    raise NotImplementedError


def consume_object(value: object) -> None:
    pass


def consume_base(value: Base) -> None:
    pass


def consume_user_id(value: UserId) -> None:
    pass


def consume_legacy_user_id(value: LegacyUserId) -> None:
    pass


consumer_args = merge_consumers(consume_object, consume_base)
reveal_type(consumer_args, expected_text="tuple[Base]")


# This should generate an error because a union is unsafe in a contravariant position.
merge_consumers(consume_user_id, consume_legacy_user_id)


class Array(Generic[*Ts]):
    pass


def combine_arrays(left: Array[*Ts], right: Array[*Ts]) -> Array[*Ts]:
    raise NotImplementedError


def check_invariant_arrays(
    left: Array[BatchDimension, StaticDimension],
    same: Array[BatchDimension, StaticDimension],
    dynamic: Array[BatchDimension, Dimension],
):
    exact = combine_arrays(left, same)
    reveal_type(exact, expected_text="Array[BatchDimension, StaticDimension]")

    # This should generate an error because Array is invariant.
    combine_arrays(left, dynamic)


def check_special_types(any_value: Any, known: UserId, never_value: Never):
    known_then_any = zip_record_types((known,), (any_value,))
    reveal_type(known_then_any, expected_text="tuple[UserId]")

    any_then_known = zip_record_types((any_value,), (known,))
    reveal_type(any_then_known, expected_text="tuple[Any]")

    known_then_never = zip_record_types((known,), (never_value,))
    reveal_type(known_then_never, expected_text="tuple[UserId]")

    never_then_known = zip_record_types((never_value,), (known,))
    reveal_type(never_then_known, expected_text="tuple[UserId]")


def check_unknown(unknown_value, known: UserId):
    reveal_type(unknown_value, expected_text="Unknown")

    known_then_unknown = zip_record_types((known,), (unknown_value,))
    reveal_type(known_then_unknown, expected_text="tuple[UserId]")

    unknown_then_known = zip_record_types((unknown_value,), (known,))
    reveal_type(unknown_then_known, expected_text="tuple[UserId]")


TBound = TypeVar("TBound", bound=Base)
TConstrained = TypeVar("TConstrained", int, str)


def merge_bound(
    left: tuple[TBound, *Ts],
    right: tuple[TBound, *Ts],
) -> tuple[TBound, *Ts]:
    raise NotImplementedError


def merge_constrained(
    left: tuple[TConstrained, *Ts],
    right: tuple[TConstrained, *Ts],
) -> tuple[TConstrained, *Ts]:
    raise NotImplementedError


class NotBase:
    pass


def check_surrounding_typevars(
    base: Base,
    sub: Sub,
    not_base: NotBase,
    user_id: UserId,
    legacy_id: LegacyUserId,
    flag: bool,
):
    bound_result = merge_bound((base, user_id), (sub, legacy_id))
    reveal_type(bound_result, expected_text="tuple[Base, UserId | LegacyUserId]")

    constrained_result = merge_constrained((1, user_id), (2 if flag else 3, legacy_id))
    reveal_type(constrained_result, expected_text="tuple[int, UserId | LegacyUserId]")

    # This should generate an error because NotBase violates TBound's bound.
    merge_bound((base, user_id), (not_base, user_id))

    # This should generate an error because a constrained TypeVar cannot widen to int | str.
    merge_constrained((1, user_id), ("", user_id))


@overload
def merge_tagged(
    tag: Literal["number"],
    left: tuple[int, *Ts],
    right: tuple[int, *Ts],
) -> tuple[Literal["number"], *Ts]:
    ...


@overload
def merge_tagged(
    tag: Literal["text"],
    left: tuple[str, *Ts],
    right: tuple[str, *Ts],
) -> tuple[Literal["text"], *Ts]:
    ...


def merge_tagged(tag: Any, left: Any, right: Any) -> Any:
    raise NotImplementedError


tagged_result = merge_tagged(
    "number",
    (1, UserId(), Payload()),
    (2, LegacyUserId(), EncodedPayload()),
)
reveal_type(
    tagged_result,
    expected_text="tuple[Literal['number'], UserId | LegacyUserId, Payload | EncodedPayload]",
)


# This should generate errors because widening Ts must not hide a bad overload discriminator.
merge_tagged(
    "number",
    (1, UserId()),
    ("", UserId()),
)
