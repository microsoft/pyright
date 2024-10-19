import datetime
from _typeshed import Incomplete, SupportsItems
from collections.abc import Callable
from typing import Any, ClassVar, Final, Literal, overload
from typing_extensions import TypeIs

from .caselessdict import CaselessDict
from .parser import Contentline, Contentlines
from .prop import TypesFactory

__all__ = [
    "Alarm",
    "Calendar",
    "Component",
    "ComponentFactory",
    "Event",
    "FreeBusy",
    "INLINE",
    "Journal",
    "Timezone",
    "TimezoneDaylight",
    "TimezoneStandard",
    "Todo",
    "component_factory",
    "get_example",
    "IncompleteComponent",
    "InvalidCalendar",
]

def get_example(component_directory: str, example_name: str) -> bytes: ...

class ComponentFactory(CaselessDict[Incomplete]):
    def __init__(self, *args, **kwargs) -> None: ...

INLINE: CaselessDict[int]

class InvalidCalendar(ValueError): ...
class IncompleteComponent(ValueError): ...

class Component(CaselessDict[Incomplete]):
    name: ClassVar[str | None]
    required: ClassVar[tuple[str, ...]]
    singletons: ClassVar[tuple[str, ...]]
    multiple: ClassVar[tuple[str, ...]]
    exclusive: ClassVar[tuple[str, ...]]
    inclusive: ClassVar[tuple[tuple[str, ...], ...]]
    ignore_exceptions: ClassVar[bool]
    subcomponents: list[Incomplete]
    errors: list[str]

    def __init__(self, *args, **kwargs) -> None: ...
    def __bool__(self) -> bool: ...
    __nonzero__ = __bool__
    def is_empty(self) -> bool: ...
    @overload
    def add(self, name: str, value: Any, *, encode: Literal[False]) -> None: ...
    @overload
    def add(self, name: str, value: Any, parameters: None, encode: Literal[False]) -> None: ...
    @overload
    def add(
        self, name: str, value: Any, parameters: SupportsItems[str, str | None] | None = None, encode: Literal[True] = True
    ) -> None: ...
    def decoded(self, name, default=[]): ...
    def get_inline(self, name, decode: bool = True): ...
    def set_inline(self, name, values, encode: bool = True) -> None: ...
    def add_component(self, component: Component) -> None: ...
    def walk(self, name: str | None = None, select: Callable[[Component], bool] = ...): ...
    def property_items(self, recursive: bool = True, sorted: bool = True): ...
    @overload
    @classmethod
    def from_ical(cls, st: str, multiple: Literal[False] = False) -> Component: ...  # or any of its subclasses
    @overload
    @classmethod
    def from_ical(cls, st: str, multiple: Literal[True]) -> list[Component]: ...  # or any of its subclasses
    def content_line(self, name: str, value, sorted: bool = True) -> Contentline: ...
    def content_lines(self, sorted: bool = True) -> Contentlines: ...
    def to_ical(self, sorted: bool = True) -> bytes: ...
    def __eq__(self, other: Component) -> bool: ...  # type: ignore[override]

# type_def is a TypeForm
def create_single_property(prop: str, value_attr: str, value_type: tuple[type, ...], type_def: Any, doc: str) -> property: ...
def is_date(dt: datetime.date) -> bool: ...  # TypeIs[datetime.date and not datetime.datetime]
def is_datetime(dt: datetime.date) -> TypeIs[datetime.datetime]: ...

class Event(Component):
    name: ClassVar[Literal["VEVENT"]]
    @classmethod
    def example(cls, name: str) -> Event: ...
    @property
    def DTSTART(self) -> datetime.date | datetime.datetime | None: ...
    @DTSTART.setter
    def DTSTART(self, value: datetime.date | datetime.datetime | None) -> None: ...
    @property
    def DTEND(self) -> datetime.date | datetime.datetime | None: ...
    @DTEND.setter
    def DTEND(self, value: datetime.date | datetime.datetime | None) -> None: ...
    @property
    def DURATION(self) -> datetime.timedelta | None: ...
    @DURATION.setter
    def DURATION(self, value: datetime.timedelta | None) -> None: ...
    @property
    def duration(self) -> datetime.timedelta: ...
    @property
    def start(self) -> datetime.date | datetime.datetime: ...
    @start.setter
    def start(self, value: datetime.date | datetime.datetime | None) -> None: ...
    @property
    def end(self) -> datetime.date | datetime.datetime: ...
    @end.setter
    def end(self, value: datetime.date | datetime.datetime | None) -> None: ...

class Todo(Component):
    name: ClassVar[Literal["VTODO"]]

class Journal(Component):
    name: ClassVar[Literal["VJOURNAL"]]
    @property
    def DTSTART(self) -> datetime.date | datetime.datetime | None: ...
    @DTSTART.setter
    def DTSTART(self, value: datetime.date | datetime.datetime | None) -> None: ...
    @property
    def start(self) -> datetime.date | datetime.datetime: ...
    @start.setter
    def start(self, value: datetime.date | datetime.datetime | None) -> None: ...
    end = start
    @property
    def duration(self) -> datetime.timedelta: ...

class FreeBusy(Component):
    name: ClassVar[Literal["VFREEBUSY"]]

class Timezone(Component):
    name: ClassVar[Literal["VTIMEZONE"]]
    @classmethod
    def example(cls, name: str) -> Calendar: ...
    def to_tz(self, tzp=...): ...  # FIXME -> DstTzInfo: ...
    @property
    def tz_name(self) -> str: ...
    def get_transitions(self) -> tuple[list[datetime.datetime], list[tuple[datetime.timedelta, datetime.timedelta, str]]]: ...

class TimezoneStandard(Component):
    name: ClassVar[Literal["STANDARD"]]

class TimezoneDaylight(Component):
    name: ClassVar[Literal["DAYLIGHT"]]

class Alarm(Component):
    name: ClassVar[Literal["VALARM"]]

class Calendar(Component):
    name: ClassVar[Literal["VCALENDAR"]]
    @classmethod
    def example(cls, name: str) -> Calendar: ...

types_factory: Final[TypesFactory]
component_factory: Final[ComponentFactory]
