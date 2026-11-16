# This sample tests guaranteed mapping matches for singleton values and
# optional keys whose presence changes through assignment and deletion.

from typing import Generic, Literal, TypeVar, TypedDict

from typing_extensions import NotRequired


class Empty(TypedDict):
    kind: Literal["empty"]
    data: None


class Text(TypedDict):
    kind: Literal["text"]
    data: str


def none_single_key(message: Empty | Text) -> str:
    match message:
        case {"data": None}:
            reveal_type(message, expected_text="Empty")
            return ""
        case _:
            reveal_type(message, expected_text="Text")
            return message["data"]


def none_multiple_keys(message: Empty | Text) -> str:
    match message:
        case {"kind": "empty", "data": None, **rest}:
            reveal_type(message, expected_text="Empty")
            return ""
        case _:
            reveal_type(message, expected_text="Text")
            return message["data"]


class OptionalMessage(TypedDict):
    kind: Literal["optional"]
    value: NotRequired[Literal[1, 2]]
    other: NotRequired[str]


def deleted_capture(message: OptionalMessage) -> str:
    message["value"] = 1
    del message["value"]
    match message:
        case {"kind": "optional", "value": _}:
            return "present"
        case _:
            reveal_type(message, expected_text="OptionalMessage")
            # This should generate an error because the fallback is reachable.
            return 0


class LiteralMessage(TypedDict):
    kind: Literal["literal"]
    value: NotRequired[Literal[1]]


def deleted_literal(message: LiteralMessage) -> str:
    message["value"] = 1
    del message["value"]
    match message:
        case {"kind": "literal", "value": 1}:
            return "present"
        case _:
            reveal_type(message, expected_text="LiteralMessage")
            # This should generate an error because the fallback is reachable.
            return 0


def deleted_single_key(message: OptionalMessage) -> str:
    message["value"] = 1
    del message["value"]
    match message:
        case {"value": _}:
            return "present"
        case _:
            reveal_type(message, expected_text="OptionalMessage")
            # This should generate an error because the fallback is reachable.
            return 0


def deleted_concatenated_key(message: LiteralMessage) -> str:
    message["value"] = 1
    del message["val" "ue"]
    match message:
        case {"kind": "literal", "value": _}:
            return "present"
        case _:
            # This should generate an error because the fallback is reachable.
            return 0


def deleted_variable_key(message: LiteralMessage) -> str:
    message["value"] = 1
    key: Literal["value"] = "value"
    del message[key]
    match message:
        case {"kind": "literal", "value": _}:
            return "present"
        case _:
            # This should generate an error because the fallback is reachable.
            return 0


def deleted_union_key(message: OptionalMessage, key: Literal["value", "other"]) -> str:
    message["value"] = 1
    message["other"] = "present"
    del message[key]
    match message:
        case {"kind": "optional", "value": _}:
            return "present"
        case _:
            # This should generate an error because "value" may have been deleted.
            return 0


def deleted_unknown_key(message: OptionalMessage, key: str) -> str:
    message["value"] = 1
    message["other"] = "present"
    del message[key]
    match message:
        case {"kind": "optional", "value": _}:
            return "present"
        case _:
            # This should generate an error because "value" may have been deleted.
            return 0


def deletion_preserves_other_keys(message: OptionalMessage) -> None:
    message["value"] = 1
    message["other"] = "present"
    del message["value"]
    reveal_type(message["other"], expected_text="Literal['present']")
    # This should generate an error because the key is no longer known present.
    message["value"]


def assigned_capture(message: OptionalMessage) -> None:
    message["value"] = 1
    match message:
        case {"kind": "optional", "value": captured}:
            reveal_type(captured, expected_text="Literal[1, 2]")
        case _:
            reveal_type(message, expected_text="Never")


def reassigned_capture(message: OptionalMessage) -> None:
    message["value"] = 1
    del message["value"]
    message["value"] = 2
    match message:
        case {"kind": "optional", "value": _}:
            pass
        case _:
            reveal_type(message, expected_text="Never")


def narrowed_then_deleted(message: OptionalMessage) -> None:
    match message:
        case {"kind": "optional", "value": 1}:
            del message["value"]
            match message:
                case {"kind": "optional", "value": _}:
                    pass
                case _:
                    reveal_type(message, expected_text="OptionalMessage")
        case _:
            pass


def narrowed_then_reassigned(message: OptionalMessage) -> None:
    match message:
        case {"kind": "optional", "value": 1}:
            del message["value"]
            message["value"] = 2
            match message:
                case {"kind": "optional", "value": captured}:
                    reveal_type(captured, expected_text="Literal[1, 2]")
                case _:
                    reveal_type(message, expected_text="Never")
        case _:
            pass


class Tagged(TypedDict):
    kind: Literal["tagged"]


T = TypeVar("T")


class GenericMessage(Tagged, Generic[T]):
    payload: T


def specialized_inherited_keys(message: GenericMessage[Literal[1]] | None) -> None:
    match message:
        case {"kind": "tagged", "payload": 1}:
            reveal_type(message, expected_text="GenericMessage[Literal[1]]")
        case _:
            reveal_type(message, expected_text="None")


def captured_generic(message: GenericMessage[T] | None) -> None:
    match message:
        case {"kind": "tagged", "payload": captured}:
            reveal_type(captured, expected_text="T@captured_generic")
        case _:
            reveal_type(message, expected_text="None")
