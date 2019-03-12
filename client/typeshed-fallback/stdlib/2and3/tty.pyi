# Stubs for tty (Python 3.6)

from typing import IO, Union

_FD = Union[int, IO[str]]

# XXX: Undocumented integer constants
IFLAG = ...  # type: int
OFLAG = ...  # type: int
CFLAG = ...  # type: int
LFLAG = ...  # type: int
ISPEED = ...  # type: int
OSPEED = ...  # type: int
CC = ...  # type: int

def setraw(fd: _FD, when: int = ...) -> None: ...
def setcbreak(fd: _FD, when: int = ...) -> None: ...
