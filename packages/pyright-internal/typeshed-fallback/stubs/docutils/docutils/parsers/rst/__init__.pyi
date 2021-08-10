from typing import Any, ClassVar, Tuple
from typing_extensions import Literal

from docutils import parsers

class Parser(parsers.Parser):
    config_section_dependencies: ClassVar[Tuple[str, ...]]
    initial_state: Literal["Body", "RFC2822Body"]
    state_classes: Any
    inliner: Any
    def __init__(self, rfc2822: bool = ..., inliner: Any | None = ...) -> None: ...

class DirectiveError(Exception):
    level: Any
    msg: str
    def __init__(self, level: Any, message: str) -> None: ...

class Directive:
    def __getattr__(self, name: str) -> Any: ...  # incomplete

def convert_directive_function(directive_fn): ...
