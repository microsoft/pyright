from _typeshed import Incomplete
from collections.abc import Callable

from networkx.classes.digraph import DiGraph
from networkx.classes.graph import Graph, _Node
from networkx.utils.backends import _dispatchable
from numpy.random import RandomState

__all__ = [
    "traveling_salesman_problem",
    "christofides",
    "asadpour_atsp",
    "greedy_tsp",
    "simulated_annealing_tsp",
    "threshold_accepting_tsp",
]

@_dispatchable
def christofides(G: Graph[_Node], weight: str | None = "weight", tree: Graph[_Node] | None = None): ...
@_dispatchable
def traveling_salesman_problem(
    G: Graph[_Node],
    weight: str = "weight",
    nodes=None,
    cycle: bool = True,
    method: Callable[..., Incomplete] | None = None,
    **kwargs,
): ...
@_dispatchable
def asadpour_atsp(
    G: DiGraph[_Node], weight: str | None = "weight", seed: int | RandomState | None = None, source: str | None = None
): ...
@_dispatchable
def greedy_tsp(G: Graph[_Node], weight: str | None = "weight", source=None): ...
@_dispatchable
def simulated_annealing_tsp(
    G: Graph[_Node],
    init_cycle,
    weight: str | None = "weight",
    source=None,
    temp: int | None = 100,
    move="1-1",
    max_iterations: int | None = 10,
    N_inner: int | None = 100,
    alpha=0.01,
    seed: int | RandomState | None = None,
): ...
@_dispatchable
def threshold_accepting_tsp(
    G: Graph[_Node],
    init_cycle,
    weight: str | None = "weight",
    source=None,
    threshold: int | None = 1,
    move="1-1",
    max_iterations: int | None = 10,
    N_inner: int | None = 100,
    alpha=0.1,
    seed: int | RandomState | None = None,
): ...
