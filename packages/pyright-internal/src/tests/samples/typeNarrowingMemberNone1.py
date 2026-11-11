# This sample checks that member equality with None preserves custom equality,
# resolved None names, and declared property return types without changing identity narrowing.

from typing import Literal


class EqualNone:
    def __eq__(self, other: object) -> bool:
        return other is None

    def __ne__(self, other: object) -> bool:
        return other is not None


class Custom:
    tag: EqualNone = EqualNone()
    payload: str = "text"


class Empty:
    tag: None = None
    payload: int = 1


def custom_equality(x: Custom | Empty):
    if x.tag == None:
        reveal_type(x, expected_text="Custom | Empty")
        # This should generate an error: Custom can compare equal to None.
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="Custom")
        x.payload.upper()

    if x.tag != None:
        reveal_type(x, expected_text="Custom")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="Custom | Empty")
        # This should generate an error: negating != also admits Custom.
        _ = x.payload + 1


def custom_class_equality(x: type[Custom] | type[Empty]):
    if x.tag == None:
        reveal_type(x, expected_text="type[Custom] | type[Empty]")
        # This should generate an error for the class receiver too.
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="type[Custom]")
        x.payload.upper()

    if x.tag != None:
        reveal_type(x, expected_text="type[Custom]")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="type[Custom] | type[Empty]")
        # This should generate an error for the negative class branch too.
        _ = x.payload + 1


def custom_identity(x: Custom | Empty):
    if x.tag is None:
        reveal_type(x, expected_text="Empty")
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="Custom")
        x.payload.upper()

    if x.tag is not None:
        reveal_type(x, expected_text="Custom")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="Empty")
        _ = x.payload + 1


class Text:
    tag: Literal["text"] = "text"
    payload: str = "text"


def none_name(x: Empty | Text, none: None):
    if x.tag == none:
        reveal_type(x, expected_text="Empty")
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="Text")
        x.payload.upper()

    if x.tag != none:
        reveal_type(x, expected_text="Text")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="Empty")
        _ = x.payload + 1


def none_name_class(x: type[Empty] | type[Text], none: Literal[None]):
    if x.tag == none:
        reveal_type(x, expected_text="type[Empty]")
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="type[Text]")
        x.payload.upper()

    if x.tag != none:
        reveal_type(x, expected_text="type[Text]")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="type[Empty]")
        _ = x.payload + 1


class EmptyProperty:
    @property
    def tag(self) -> None:
        return None

    payload: int = 1


class TextProperty:
    @property
    def tag(self) -> Literal["text"]:
        return "text"

    payload: str = "text"


def property_equality(x: EmptyProperty | TextProperty, none: None):
    if x.tag == None:
        reveal_type(x, expected_text="EmptyProperty")
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="TextProperty")
        x.payload.upper()

    if x.tag != None:
        reveal_type(x, expected_text="TextProperty")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="EmptyProperty")
        _ = x.payload + 1

    if x.tag == none:
        reveal_type(x, expected_text="EmptyProperty")
        _ = x.payload + 1
    else:
        reveal_type(x, expected_text="TextProperty")
        x.payload.upper()

    if x.tag != none:
        reveal_type(x, expected_text="TextProperty")
        x.payload.upper()
    else:
        reveal_type(x, expected_text="EmptyProperty")
        _ = x.payload + 1


def property_identity(x: EmptyProperty | TextProperty):
    if x.tag is None:
        reveal_type(x, expected_text="EmptyProperty | TextProperty")
    else:
        reveal_type(x, expected_text="EmptyProperty | TextProperty")

    if x.tag is not None:
        reveal_type(x, expected_text="EmptyProperty | TextProperty")
    else:
        reveal_type(x, expected_text="EmptyProperty | TextProperty")
