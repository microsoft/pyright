# This sample tests bidirectional type inference (expected type) for
# lists that include TypedDicts.

from typing import TypeVar, TypedDict


MessageTypeDef = TypedDict("MessageTypeDef", {"Id": str, "Handle": str})

msgs = [{"Id": "1", "Handle": "2"}]
list2: list[MessageTypeDef] = [
    {"Id": msg["Id"], "Handle": msg["Handle"]} for msg in msgs
]

TMessage = TypeVar("TMessage", bound=MessageTypeDef)


def func1(x: list[TMessage]) -> TMessage: ...


func1([{"Id": "", "Handle": ""}])
