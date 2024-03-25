from abc import ABCMeta
from logging import Logger

logger: Logger

class VaultApiBase(metaclass=ABCMeta):
    def __init__(self, adapter) -> None: ...
