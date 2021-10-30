# This sample tests that args and kwargs parameters are
# properly typed.

from typing import Tuple, Dict, List


def function_with_args(*args: str) -> Tuple[str, ...]:
    return args


def function_with_kwargs(**kwargs: List[str]) -> Dict[str, List[str]]:
    return kwargs
