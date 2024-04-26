from _typeshed import Incomplete

class NetworkApiMixin:
    def networks(self, names: Incomplete | None = None, ids: Incomplete | None = None, filters: Incomplete | None = None): ...
    def create_network(
        self,
        name,
        driver: Incomplete | None = None,
        options: Incomplete | None = None,
        ipam: Incomplete | None = None,
        check_duplicate: Incomplete | None = None,
        internal: bool = False,
        labels: Incomplete | None = None,
        enable_ipv6: bool = False,
        attachable: Incomplete | None = None,
        scope: Incomplete | None = None,
        ingress: Incomplete | None = None,
    ): ...
    def prune_networks(self, filters: Incomplete | None = None): ...
    def remove_network(self, net_id) -> None: ...
    def inspect_network(self, net_id, verbose: Incomplete | None = None, scope: Incomplete | None = None): ...
    def connect_container_to_network(
        self,
        container,
        net_id,
        ipv4_address: Incomplete | None = None,
        ipv6_address: Incomplete | None = None,
        aliases: Incomplete | None = None,
        links: Incomplete | None = None,
        link_local_ips: Incomplete | None = None,
        driver_opt: Incomplete | None = None,
        mac_address: Incomplete | None = None,
    ) -> None: ...
    def disconnect_container_from_network(self, container, net_id, force: bool = False) -> None: ...
