from abc import ABCMeta, abstractmethod
from collections.abc import Sequence
from logging import Logger

from hvac.adapters import Adapter
from hvac.api.vault_api_base import VaultApiBase

logger: Logger

class VaultApiCategory(VaultApiBase, metaclass=ABCMeta):
    implemented_class_names: Sequence[str]
    def __init__(self, adapter: Adapter) -> None: ...
    def __getattr__(self, item): ...
    @property
    def adapter(self) -> Adapter: ...
    @adapter.setter
    def adapter(self, adapter: Adapter) -> None: ...
    @property
    @abstractmethod
    def implemented_classes(self): ...
    @property
    def unimplemented_classes(self) -> None: ...
    @staticmethod
    def get_private_attr_name(class_name): ...
