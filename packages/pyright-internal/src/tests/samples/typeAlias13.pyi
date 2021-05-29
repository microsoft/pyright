# This sample tests the case where a recursive type alias
# indirectly refers to itself in a way that is illegal.

_str = str

def str(val: float) -> _str: ...

_int = int

def int(val: _int) -> None: ...
