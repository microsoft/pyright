# This sample exercises the type analyzer's assert type
# constraint logic for tests of the form "type(X) is Y"
# or "type(X) is not Y".

from typing import Any, Dict, Optional, Union

def func1(a: Union[str, int]) -> int:

    if type(a) is not str:
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a

def func2(a: Optional[str]) -> str:

    if type(a) is str:
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a

def func3(a: Dict[str, Any]) -> str:
    val = a.get('hello')
    if type(val) is str:
        return val

    return 'none'

    