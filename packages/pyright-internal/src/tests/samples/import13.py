# This sample is used in conjunction with import14.py to test
# PEP 562 (module-level __getattr__) support.


def __getattr__(name: str) -> int: ...
