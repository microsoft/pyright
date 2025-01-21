from _typeshed import Incomplete

from .behavior import Behavior

class Name:
    family: Incomplete
    given: Incomplete
    additional: Incomplete
    prefix: Incomplete
    suffix: Incomplete
    def __init__(self, family: str = "", given: str = "", additional: str = "", prefix: str = "", suffix: str = "") -> None: ...
    @staticmethod
    def toString(val): ...
    def __eq__(self, other): ...

class Address:
    box: Incomplete
    extended: Incomplete
    street: Incomplete
    city: Incomplete
    region: Incomplete
    code: Incomplete
    country: Incomplete
    def __init__(
        self,
        street: str = "",
        city: str = "",
        region: str = "",
        code: str = "",
        country: str = "",
        box: str = "",
        extended: str = "",
    ) -> None: ...
    @staticmethod
    def toString(val, join_char: str = "\n"): ...
    lines: Incomplete
    one_line: Incomplete
    def __eq__(self, other): ...

class VCardTextBehavior(Behavior):
    allowGroup: bool
    base64string: str
    @classmethod
    def decode(cls, line) -> None: ...
    @classmethod
    def encode(cls, line) -> None: ...

class VCardBehavior(Behavior):
    allowGroup: bool
    defaultBehavior: Incomplete

class VCard3_0(VCardBehavior):
    name: str
    description: str
    versionString: str
    isComponent: bool
    sortFirst: Incomplete
    @classmethod
    def generateImplicitParameters(cls, obj) -> None: ...

class FN(VCardTextBehavior):
    name: str
    description: str

class Label(VCardTextBehavior):
    name: str
    description: str

class GEO(VCardBehavior): ...

wacky_apple_photo_serialize: bool
REALLY_LARGE: float

class Photo(VCardTextBehavior):
    name: str
    description: str
    @classmethod
    def valueRepr(cls, line): ...
    @classmethod
    def serialize(cls, obj, buf, lineLength, validate, *args, **kwargs) -> None: ...  # type: ignore[override]

def toListOrString(string): ...
def splitFields(string): ...
def toList(stringOrList): ...
def serializeFields(obj, order: Incomplete | None = None): ...

NAME_ORDER: Incomplete
ADDRESS_ORDER: Incomplete

class NameBehavior(VCardBehavior):
    hasNative: bool
    @staticmethod
    def transformToNative(obj): ...
    @staticmethod
    def transformFromNative(obj): ...

class AddressBehavior(VCardBehavior):
    hasNative: bool
    @staticmethod
    def transformToNative(obj): ...
    @staticmethod
    def transformFromNative(obj): ...

class OrgBehavior(VCardBehavior):
    hasNative: bool
    @staticmethod
    def transformToNative(obj): ...
    @staticmethod
    def transformFromNative(obj): ...
