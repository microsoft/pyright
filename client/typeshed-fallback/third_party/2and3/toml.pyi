from typing import Any, IO, List, Mapping, MutableMapping, Optional, Text, Type, Union
from _typeshed import StrPath
import datetime
import sys
from _typeshed import SupportsWrite

if sys.version_info >= (3, 6):
    _PathLike = StrPath
elif sys.version_info >= (3, 4):
    import pathlib
    _PathLike = Union[StrPath, pathlib.PurePath]
else:
    _PathLike = StrPath

class TomlDecodeError(Exception): ...

def load(f: Union[_PathLike, List[Text], IO[str]], _dict: Type[MutableMapping[str, Any]] = ...) -> MutableMapping[str, Any]: ...
def loads(s: Text, _dict: Type[MutableMapping[str, Any]] = ...) -> MutableMapping[str, Any]: ...

def dump(o: Mapping[str, Any], f: SupportsWrite[str]) -> str: ...
def dumps(o: Mapping[str, Any]) -> str: ...
