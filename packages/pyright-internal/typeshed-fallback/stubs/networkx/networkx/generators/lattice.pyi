from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def grid_2d_graph(m, n, periodic: bool = False, create_using: Incomplete | None = None): ...
@_dispatchable
def grid_graph(dim, periodic: bool = False): ...
@_dispatchable
def hypercube_graph(n): ...
@_dispatchable
def triangular_lattice_graph(
    m, n, periodic: bool = False, with_positions: bool = True, create_using: Incomplete | None = None
): ...
@_dispatchable
def hexagonal_lattice_graph(
    m, n, periodic: bool = False, with_positions: bool = True, create_using: Incomplete | None = None
): ...
