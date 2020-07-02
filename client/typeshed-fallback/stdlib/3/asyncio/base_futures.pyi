import contextvars
from typing import Callable, List, Sequence, Tuple
from typing_extensions import Literal

from . import futures

_PENDING: Literal["PENDING"]  # undocumented
_CANCELLED: Literal["CANCELLED"]  # undocumented
_FINISHED: Literal["FINISHED"]  # undocumented

def isfuture(obj: object) -> bool: ...
def _format_callbacks(cb: Sequence[Tuple[Callable[[futures.Future], None], contextvars.Context]]) -> str: ...  # undocumented
def _future_repr_info(future: futures.Future) -> List[str]: ...  # undocumented
