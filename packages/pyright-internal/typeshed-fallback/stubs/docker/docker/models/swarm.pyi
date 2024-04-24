from _typeshed import Incomplete

from .resource import Model

class Swarm(Model):
    id_attribute: str
    def __init__(self, *args, **kwargs) -> None: ...
    @property
    def version(self): ...
    def get_unlock_key(self): ...
    def init(
        self,
        advertise_addr: Incomplete | None = None,
        listen_addr: str = "0.0.0.0:2377",
        force_new_cluster: bool = False,
        default_addr_pool: Incomplete | None = None,
        subnet_size: Incomplete | None = None,
        data_path_addr: Incomplete | None = None,
        data_path_port: Incomplete | None = None,
        **kwargs,
    ): ...
    def join(self, *args, **kwargs): ...
    def leave(self, *args, **kwargs): ...
    attrs: Incomplete
    def reload(self) -> None: ...
    def unlock(self, key): ...
    def update(
        self,
        rotate_worker_token: bool = False,
        rotate_manager_token: bool = False,
        rotate_manager_unlock_key: bool = False,
        **kwargs,
    ): ...
