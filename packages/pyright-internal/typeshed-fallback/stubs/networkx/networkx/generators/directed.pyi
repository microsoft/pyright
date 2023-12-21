from _typeshed import Incomplete

def gn_graph(n, kernel: Incomplete | None = None, create_using: Incomplete | None = None, seed: Incomplete | None = None): ...
def gnr_graph(n, p, create_using: Incomplete | None = None, seed: Incomplete | None = None): ...
def gnc_graph(n, create_using: Incomplete | None = None, seed: Incomplete | None = None): ...
def scale_free_graph(
    n,
    alpha: float = 0.41,
    beta: float = 0.54,
    gamma: float = 0.05,
    delta_in: float = 0.2,
    delta_out: float = 0,
    create_using: Incomplete | None = None,
    seed: Incomplete | None = None,
    initial_graph: Incomplete | None = None,
): ...
def random_k_out_graph(n, k, alpha, self_loops: bool = True, seed: Incomplete | None = None): ...
