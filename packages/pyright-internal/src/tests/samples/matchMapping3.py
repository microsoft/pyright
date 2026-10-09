# This sample tests presence invalidation through mutating methods and
# conditional or loop-based deletion of optional TypedDict keys.

from typing import NotRequired, TypedDict


class Message(TypedDict):
    value: NotRequired[int]


def popped() -> int:
    message: Message = {"value": 1}
    message.pop("value")
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because the fallback is reachable.
            return "missing"


def conditionally_deleted(message: Message, remove: bool) -> int:
    message["value"] = 1
    if remove:
        del message["value"]
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because one branch deletes the key.
            return "missing"


def conditionally_popped(message: Message, remove: bool) -> int:
    message["value"] = 1
    if remove:
        message.pop("value")
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because one branch removes the key.
            return "missing"


def deleted_in_loop(message: Message, count: int) -> int:
    message["value"] = 1
    for _ in range(count):
        del message["value"]
        break
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because the loop may delete the key.
            return "missing"


class Pair(TypedDict):
    value: NotRequired[int]
    other: NotRequired[int]


def pop_preserves_other_keys(message: Pair) -> None:
    message["value"] = 1
    message["other"] = 2
    message.pop("value", 0)
    reveal_type(message["other"], expected_text="Literal[2]")
    # This should generate an error because "value" is no longer known present.
    message["value"]


class ClosedMessage(TypedDict, closed=True):
    value: NotRequired[int]


def cleared() -> int:
    message: ClosedMessage = {"value": 1}
    message.clear()
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because clear removed the key.
            return "missing"


def popped_item() -> int:
    message: ClosedMessage = {"value": 1}
    message.popitem()
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because popitem removed the key.
            return "missing"


def deleted_by_method() -> int:
    message: Message = {"value": 1}
    message.__delitem__("value")
    match message:
        case {"value": _}:
            return 1
        case _:
            # This should generate an error because __delitem__ removed the key.
            return "missing"


def assigned_in_both_branches(message: Message, branch: bool) -> None:
    if branch:
        message["value"] = 1
    else:
        message["value"] = 2
    match message:
        case {"value": captured}:
            reveal_type(captured, expected_text="int")
        case _:
            reveal_type(message, expected_text="Never")


def nonmutating_call(message: Message) -> None:
    message["value"] = 1
    message.get("value")
    match message:
        case {"value": _}:
            pass
        case _:
            reveal_type(message, expected_text="Never")


def assigned_after_pop(message: Message) -> None:
    message["value"] = 1
    message.pop("value")
    message["value"] = 2
    match message:
        case {"value": _}:
            pass
        case _:
            reveal_type(message, expected_text="Never")
