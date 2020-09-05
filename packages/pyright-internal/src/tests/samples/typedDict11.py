# This sample tests bidirectional type inference (expected type) for
# lists that include TypedDicts.

from typing import List, TypedDict


MessageTypeDef = TypedDict("MessageTypeDef", {"Id": str, "Handle": str})

msgs = [{"Id": "1", "Handle": "2"}]
list2: List[MessageTypeDef] = [
    {"Id": msg["Id"], "Handle": msg["Handle"]} for msg in msgs
]

