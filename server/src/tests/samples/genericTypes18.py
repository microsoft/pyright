# This sample tests handling of user-defined type aliases.

from datetime import datetime
from typing import Callable, TypeVar, Union


from typing import TypeVar, Union, Optional
S = TypeVar('S')

Response1 = Optional[Union[S, int]]

def f1_1() -> Response1[str]:
    return None

def f1_2() -> Response1[str]:
    return 's'

def f1_3() -> Response1[float]:
    # This should generate an error.
    return 's'

Response2 = Union[S, int]

def f2_1() -> Response2:
    return 's'

def f2_2() -> Response2[str]:
    return 's'

def f2_3() -> Response2[float]:
    return 3.4

def f2_4() -> Response2[datetime]:
    # This should generate an error
    return 3.4


Response3 = Callable[[S], S]

def response2(query: str) -> Response3[int]:
    return lambda x: x + 2
   
def response2(query: str) -> Response3[datetime]:
    # This should generate an error because datetime doesn't support +
    return lambda x: x + 2

