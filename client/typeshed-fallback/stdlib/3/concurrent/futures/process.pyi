from typing import Any, Callable, Optional, Tuple
from ._base import Future, Executor
import sys

EXTRA_QUEUED_CALLS = ...  # type: Any

if sys.version_info >= (3,):
    class BrokenProcessPool(RuntimeError): ...

if sys.version_info >= (3, 7):
    class ProcessPoolExecutor(Executor):
        def __init__(self, max_workers: Optional[int] = ...,
                     initializer: Optional[Callable[..., None]] = ...,
                     initargs: Tuple[Any, ...] = ...) -> None: ...
else:
    class ProcessPoolExecutor(Executor):
        def __init__(self, max_workers: Optional[int] = ...) -> None: ...
