import sys
from ctypes import Structure, Union, _NamedFuncPointer, _Pointer, c_int64, c_ulong, c_void_p
from ctypes.wintypes import DWORD
from typing_extensions import TypeAlias

if sys.platform == "win32":
    def is_64bit() -> bool: ...

    ULONG_PTR: TypeAlias = c_int64 | c_ulong

    class _SECURITY_ATTRIBUTES(Structure): ...
    LPSECURITY_ATTRIBUTES: type[_Pointer[_SECURITY_ATTRIBUTES]]
    CreateEvent: _NamedFuncPointer
    CreateFile: _NamedFuncPointer

    class _OVERLAPPED(Structure): ...
    OVERLAPPED: TypeAlias = _OVERLAPPED

    class _COMSTAT(Structure): ...
    COMSTAT: TypeAlias = _COMSTAT

    class _DCB(Structure): ...
    DCB: TypeAlias = _DCB

    class _COMMTIMEOUTS(Structure): ...
    COMMTIMEOUTS: TypeAlias = _COMMTIMEOUTS

    GetLastError: _NamedFuncPointer
    LPOVERLAPPED: type[_Pointer[_OVERLAPPED]]
    LPDWORD: type[_Pointer[DWORD]]
    GetOverlappedResult: _NamedFuncPointer
    ResetEvent: _NamedFuncPointer
    LPCVOID = c_void_p
    WriteFile: _NamedFuncPointer
    LPVOID = c_void_p
    ReadFile: _NamedFuncPointer
    CloseHandle: _NamedFuncPointer
    ClearCommBreak: _NamedFuncPointer
    LPCOMSTAT: type[_Pointer[_COMSTAT]]
    ClearCommError: _NamedFuncPointer
    SetupComm: _NamedFuncPointer
    EscapeCommFunction: _NamedFuncPointer
    GetCommModemStatus: _NamedFuncPointer
    LPDCB: type[_Pointer[_DCB]]
    GetCommState: _NamedFuncPointer
    LPCOMMTIMEOUTS: type[_Pointer[_COMMTIMEOUTS]]
    GetCommTimeouts: _NamedFuncPointer
    PurgeComm: _NamedFuncPointer
    SetCommBreak: _NamedFuncPointer
    SetCommMask: _NamedFuncPointer
    SetCommState: _NamedFuncPointer
    SetCommTimeouts: _NamedFuncPointer
    WaitForSingleObject: _NamedFuncPointer
    WaitCommEvent: _NamedFuncPointer
    CancelIoEx: _NamedFuncPointer

    ONESTOPBIT: int
    TWOSTOPBITS: int
    NOPARITY: int
    ODDPARITY: int
    EVENPARITY: int
    RTS_CONTROL_HANDSHAKE: int
    RTS_CONTROL_ENABLE: int
    DTR_CONTROL_HANDSHAKE: int
    DTR_CONTROL_ENABLE: int
    MS_DSR_ON: int
    EV_RING: int
    EV_PERR: int
    EV_ERR: int
    SETXOFF: int
    EV_RXCHAR: int
    GENERIC_WRITE: int
    PURGE_TXCLEAR: int
    FILE_FLAG_OVERLAPPED: int
    EV_DSR: int
    MAXDWORD: int
    EV_RLSD: int
    ERROR_IO_PENDING: int
    MS_CTS_ON: int
    EV_EVENT1: int
    EV_RX80FULL: int
    PURGE_RXABORT: int
    FILE_ATTRIBUTE_NORMAL: int
    PURGE_TXABORT: int
    SETXON: int
    OPEN_EXISTING: int
    MS_RING_ON: int
    EV_TXEMPTY: int
    EV_RXFLAG: int
    MS_RLSD_ON: int
    GENERIC_READ: int
    EV_EVENT2: int
    EV_CTS: int
    EV_BREAK: int
    PURGE_RXCLEAR: int

    class N11_OVERLAPPED4DOLLAR_48E(Union): ...
    class N11_OVERLAPPED4DOLLAR_484DOLLAR_49E(Structure): ...
    PVOID: TypeAlias = c_void_p
