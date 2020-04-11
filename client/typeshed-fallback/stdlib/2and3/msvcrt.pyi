# Stubs for msvcrt

# NOTE: These are incomplete!

LK_LOCK: int
LK_NBLCK: int
LK_NBRLCK: int
LK_RLCK: int
LK_UNLCK: int

def locking(fd: int, mode: int, nbytes: int) -> None: ...

def get_osfhandle(file: int) -> int: ...
def open_osfhandle(handle: int, flags: int) -> int: ...
