# This sample tests type narrowing based on key accesses
# to unions of TypedDicts that have fields with literal types.

from typing import Literal, TypedDict


class Event1(TypedDict):
    tag: Literal["new-job"]
    job_name: str
    config_file_path: str


class Event2(TypedDict):
    tag: Literal[2]
    job_id: int


class Event3(TypedDict):
    tag: Literal["other-job"]
    message: str


Event = Event1 | Event2 | Event3


def process_event1(event: Event) -> None:
    if event["tag"] == "new-job":
        reveal_type(event, expected_text="Event1")
        event["job_name"]
    elif event["tag"] == 2:
        reveal_type(event, expected_text="Event2")
        event["job_id"]
    else:
        reveal_type(event, expected_text="Event3")
        event["message"]


def process_event2(event: Event) -> None:
    if event["tag"] is "new-job":
        reveal_type(event, expected_text="Event1")
        event["job_name"]
    elif event["tag"] is 2:
        reveal_type(event, expected_text="Event2")
        event["job_id"]
    else:
        reveal_type(event, expected_text="Event3")
        event["message"]


class ClassA:
    job_event: Event1 | Event3

    def method1(self):
        if self.job_event["tag"] == "new-job":
            reveal_type(self.job_event, expected_text="Event1")
        else:
            reveal_type(self.job_event, expected_text="Event3")


class A(TypedDict):
    name: Literal["A"]
    a: str


class BC(TypedDict):
    name: Literal["B", "C"]
    b: str


AorBC = A | BC


def func1(val: AorBC, key: Literal["C", "D"]):
    if val["name"] == key:
        reveal_type(val, expected_text="BC")
    else:
        reveal_type(val, expected_text="A | BC")


def func2(val: AorBC, key: Literal["A", "D"]):
    if val["name"] == key:
        reveal_type(val, expected_text="A")
    else:
        reveal_type(val, expected_text="A | BC")


def func3(val: AorBC, key: Literal["A", "C"]):
    if val["name"] == key:
        reveal_type(val, expected_text="A | BC")
    else:
        reveal_type(val, expected_text="A | BC")


def func4(val: AorBC, key: Literal["B", "C"]):
    if val["name"] == key:
        reveal_type(val, expected_text="BC")
    else:
        reveal_type(val, expected_text="A | BC")
