from _typeshed import Incomplete

from networkx.utils.backends import _dispatchable

@_dispatchable
def categorical_node_match(attr, default): ...

categorical_edge_match: Incomplete

@_dispatchable
def categorical_multiedge_match(attr, default): ...
@_dispatchable
def numerical_node_match(attr, default, rtol: float = 1e-05, atol: float = 1e-08): ...

numerical_edge_match: Incomplete

@_dispatchable
def numerical_multiedge_match(attr, default, rtol: float = 1e-05, atol: float = 1e-08): ...
@_dispatchable
def generic_node_match(attr, default, op): ...

generic_edge_match: Incomplete

@_dispatchable
def generic_multiedge_match(attr, default, op): ...
