from _typeshed import FileDescriptor, StrOrBytesPath
from collections.abc import Callable
from typing import Optional, TypeVar
from typing_extensions import TypeAlias

from Xlib.error import XError
from Xlib.protocol.rq import Request

_T = TypeVar("_T")
ErrorHandler: TypeAlias = Callable[[XError, Optional[Request]], _T]
Unused: TypeAlias = object
OpenFile: TypeAlias = StrOrBytesPath | FileDescriptor
