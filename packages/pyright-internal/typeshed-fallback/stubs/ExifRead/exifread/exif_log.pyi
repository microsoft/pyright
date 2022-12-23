import logging
from _typeshed import Incomplete

TEXT_NORMAL: int
TEXT_BOLD: int
TEXT_RED: int
TEXT_GREEN: int
TEXT_YELLOW: int
TEXT_BLUE: int
TEXT_MAGENTA: int
TEXT_CYAN: int

def get_logger(): ...
def setup_logger(debug, color) -> None: ...

class Formatter(logging.Formatter):
    color: Incomplete
    debug: Incomplete
    def __init__(self, debug: bool = ..., color: bool = ...) -> None: ...
    def format(self, record): ...

class Handler(logging.StreamHandler[Incomplete]):
    color: Incomplete
    debug: Incomplete
    def __init__(self, log_level, debug: bool = ..., color: bool = ...) -> None: ...
