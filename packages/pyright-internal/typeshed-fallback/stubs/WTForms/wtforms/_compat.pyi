from collections.abc import Callable
from inspect import Signature
from typing import Any

def get_signature(callable: Callable[..., Any]) -> Signature: ...
