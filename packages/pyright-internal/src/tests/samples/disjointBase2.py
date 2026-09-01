# This sample tests realistic application and library patterns involving
# disjoint bases introduced in PEP 800.

from abc import ABC, abstractmethod
from dataclasses import KW_ONLY, dataclass
from typing import TYPE_CHECKING, ClassVar, NamedTuple, Protocol, TypedDict, cast

from disjointBase2Lib import KW_ONLY_ALIAS
from typing_extensions import disjoint_base  # pyright: ignore[reportMissingModuleSource]


class FrameworkModel(ABC):
    __slots__ = ("_state",)

    @abstractmethod
    def identity(self) -> str:
        raise NotImplementedError


class StorageModel(ABC):
    __slots__ = ("_connection",)


class JsonMixin:
    def to_json(self) -> str:
        return "{}"


class JsonFrameworkModel(FrameworkModel, JsonMixin):
    pass


class HybridFrameworkModel(FrameworkModel, StorageModel):  # This should generate an error
    pass


class UserModel(FrameworkModel):
    pass


class StoredUserModel(UserModel, StorageModel):  # This should generate an error
    pass


class EmptyLayoutMixin:
    __slots__ = ()


class EmptyLayoutUser(UserModel, EmptyLayoutMixin):
    pass


class InspectionMixin:
    if TYPE_CHECKING:
        __slots__ = ("_inspection",)
    else:
        __slots__ = ()


class InspectedUser(UserModel, InspectionMixin):  # This should generate an error
    pass


@dataclass(slots=True)
class SlottedMessage:
    message_id: int


@dataclass
class MessageMetadata:
    source: str


class EnrichedMessage(SlottedMessage, MessageMetadata):
    pass


class FrameworkMessage(SlottedMessage, FrameworkModel):  # This should generate an error
    pass


@dataclass(slots=True)
class EmptySlottedMarker:
    _: KW_ONLY
    category: ClassVar[str] = "message"


class MarkedFrameworkModel(FrameworkModel, EmptySlottedMarker):
    pass


@dataclass(slots=True)
class ReexportedEmptySlottedMarker:
    _: KW_ONLY_ALIAS


class ReexportedMarkedFrameworkModel(FrameworkModel, ReexportedEmptySlottedMarker):
    pass


@dataclass(slots=True)
class TypeCommentOnlySlottedMarker:
    category = "message"  # type: str


class TypeCommentMarkedFrameworkModel(FrameworkModel, TypeCommentOnlySlottedMarker):
    pass


@dataclass(slots=True)
class AssignedEmptySlottedMarker:
    _: KW_ONLY = cast(KW_ONLY, None)


AssignedEmptySlottedMarker()


class AssignedMarkedFrameworkModel(FrameworkModel, AssignedEmptySlottedMarker):
    pass


@dataclass
class DeferredNode:
    parent: "DeferredNode | None" = None


class TracedDeferredNode(DeferredNode, JsonMixin):
    pass


class EventKey(NamedTuple):
    tenant: str
    sequence: int


class JsonEventKey(EventKey, JsonMixin):
    pass


class FrameworkEventKey(EventKey, FrameworkModel):  # This should generate an error
    pass


class Renderable(Protocol):
    __slots__ = ("_renderer",)

    def render(self) -> str:
        ...


class RenderableFrameworkModel(FrameworkModel, Renderable):
    pass


class RequestHeaders(TypedDict):
    trace_id: str


class AuthenticationHeaders(TypedDict):
    user_id: int


class AuthenticatedRequestHeaders(RequestHeaders, AuthenticationHeaders):
    pass


@disjoint_base
class Resource:
    pass


class Document(Resource):
    pass


class AuditedDocument(Document, JsonMixin):
    pass


@disjoint_base
class PersistentResource(Resource):
    pass


class PersistentDocument(PersistentResource, Resource):
    pass


@disjoint_base
class Widget:
    pass


class DocumentWidget(Document, Widget):  # This should generate an error
    pass


class JsonInteger(int, JsonMixin):
    pass


class FrameworkInteger(int, FrameworkModel):  # This should generate an error
    pass


class FrameworkList(list[str], FrameworkModel):  # This should generate an error
    pass


@disjoint_base  # This should generate an error
def resource_factory() -> Resource:
    return Resource()


@disjoint_base  # This should generate an error
class ResourceRecord(TypedDict):
    resource_id: int


@disjoint_base  # This should generate an error
class ResourceListener(Protocol):
    def resource_changed(self, resource: Resource) -> None:
        ...
