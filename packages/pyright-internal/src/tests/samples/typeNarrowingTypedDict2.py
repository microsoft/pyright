# This sample tests type narrowing based on key accesses
# to unions of TypedDicts that have fields with literal types.

from typing import Literal, TypedDict


class NewJobEvent(TypedDict):
    tag: Literal["new-job"]
    job_name: str
    config_file_path: str


class CancelJobEvent(TypedDict):
    tag: Literal[2]
    job_id: int


class OtherEvent(TypedDict):
    tag: Literal["other-job"]
    message: str


Event = NewJobEvent | CancelJobEvent | OtherEvent


def process_event1(event: Event) -> None:
    if event["tag"] == "new-job":
        reveal_type(event, expected_text="NewJobEvent")
        event["job_name"]
    elif event["tag"] == 2:
        reveal_type(event, expected_text="CancelJobEvent")
        event["job_id"]
    else:
        reveal_type(event, expected_text="OtherEvent")
        event["message"]


def process_event2(event: Event) -> None:
    if event["tag"] is "new-job":
        reveal_type(event, expected_text="NewJobEvent")
        event["job_name"]
    elif event["tag"] is 2:
        reveal_type(event, expected_text="CancelJobEvent")
        event["job_id"]
    else:
        reveal_type(event, expected_text="OtherEvent")
        event["message"]


class ClassA:
    job_event: NewJobEvent | OtherEvent

    def method1(self):
        if self.job_event["tag"] == "new-job":
            reveal_type(self.job_event, expected_text="NewJobEvent")
        else:
            reveal_type(self.job_event, expected_text="OtherEvent")
