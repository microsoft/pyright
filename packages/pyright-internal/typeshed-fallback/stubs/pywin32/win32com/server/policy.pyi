from _typeshed import Incomplete

from pythoncom import (
    DISPID_COLLECT as DISPID_COLLECT,
    DISPID_CONSTRUCTOR as DISPID_CONSTRUCTOR,
    DISPID_DESTRUCTOR as DISPID_DESTRUCTOR,
    DISPID_UNKNOWN as DISPID_UNKNOWN,
)
from win32com.server.dispatcher import DispatcherTrace as DispatcherTrace, DispatcherWin32trace as DispatcherWin32trace
from win32com.server.exception import COMException as COMException

S_OK: int
IDispatchType: Incomplete
IUnknownType: Incomplete
error: Incomplete
regSpec: str
regPolicy: str
regDispatcher: str
regAddnPath: str

def CreateInstance(clsid, reqIID): ...

class BasicWrapPolicy:
    def __init__(self, object) -> None: ...

class MappedWrapPolicy(BasicWrapPolicy): ...
class DesignatedWrapPolicy(MappedWrapPolicy): ...
class EventHandlerPolicy(DesignatedWrapPolicy): ...
class DynamicPolicy(BasicWrapPolicy): ...

DefaultPolicy = DesignatedWrapPolicy

def resolve_func(spec): ...
def call_func(spec, *args): ...

DISPATCH_METHOD: int
DISPATCH_PROPERTYGET: int
DISPATCH_PROPERTYPUT: int
DISPATCH_PROPERTYPUTREF: int
DISPID_EVALUATE: int
DISPID_NEWENUM: int
DISPID_PROPERTYPUT: int
DISPID_STARTENUM: int
DISPID_VALUE: int
