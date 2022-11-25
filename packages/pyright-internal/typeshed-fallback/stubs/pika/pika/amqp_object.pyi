from typing import ClassVar

class AMQPObject:
    NAME: ClassVar[str]
    INDEX: ClassVar[int | None]
    def __eq__(self, other: AMQPObject | None) -> bool: ...  # type: ignore[override]

class Class(AMQPObject): ...

class Method(AMQPObject):
    synchronous: ClassVar[bool]
    def get_properties(self) -> Properties: ...
    def get_body(self) -> str: ...

class Properties(AMQPObject): ...
