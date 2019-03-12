from typing import Any, Callable, Optional, Tuple
from ._base import Executor, Future
import sys

class ThreadPoolExecutor(Executor):
    if sys.version_info >= (3, 7):
        def __init__(self, max_workers: Optional[int] = ...,
                     thread_name_prefix: str = ...,
                     initializer: Optional[Callable[..., None]] = ...,
                     initargs: Tuple[Any, ...] = ...) -> None: ...
    elif sys.version_info >= (3, 6) or sys.version_info < (3,):
        def __init__(self, max_workers: Optional[int] = ...,
                     thread_name_prefix: str = ...) -> None: ...
    else:
        def __init__(self, max_workers: Optional[int] = ...) -> None: ...
