from _typeshed import Incomplete

import numpy

__all__ = [
    "bipartite_layout",
    "circular_layout",
    "forceatlas2_layout",
    "kamada_kawai_layout",
    "random_layout",
    "rescale_layout",
    "rescale_layout_dict",
    "shell_layout",
    "spring_layout",
    "spectral_layout",
    "planar_layout",
    "fruchterman_reingold_layout",
    "spiral_layout",
    "multipartite_layout",
    "bfs_layout",
    "arf_layout",
]

def random_layout(G, center=None, dim: int = 2, seed=None): ...
def circular_layout(G, scale: float = 1, center=None, dim: int = 2): ...
def shell_layout(G, nlist=None, rotate=None, scale: float = 1, center=None, dim: int = 2): ...
def bipartite_layout(G, nodes, align: str = "vertical", scale: float = 1, center=None, aspect_ratio: float = ...): ...
def spring_layout(
    G,
    k=None,
    pos=None,
    fixed=None,
    iterations: int = 50,
    threshold: float = 0.0001,
    weight: str = "weight",
    scale: float = 1,
    center=None,
    dim: int = 2,
    seed=None,
): ...

fruchterman_reingold_layout = spring_layout

def kamada_kawai_layout(G, dist=None, pos=None, weight: str = "weight", scale: float = 1, center=None, dim: int = 2): ...
def spectral_layout(G, weight: str = "weight", scale: float = 1, center=None, dim: int = 2): ...
def planar_layout(G, scale: float = 1, center=None, dim: int = 2): ...
def spiral_layout(G, scale: float = 1, center=None, dim: int = 2, resolution: float = 0.35, equidistant: bool = False): ...
def multipartite_layout(G, subset_key: str = "subset", align: str = "vertical", scale: float = 1, center=None): ...
def arf_layout(
    G,
    pos=None,
    scaling: float = 1,
    a: float = 1.1,
    etol: float = 1e-06,
    dt: float = 0.001,
    max_iter: int = 1000,
    *,
    seed: int | numpy.random.RandomState | None = None,
): ...
def forceatlas2_layout(
    G,
    pos=None,
    *,
    max_iter=100,
    jitter_tolerance=1.0,
    scaling_ratio=2.0,
    gravity=1.0,
    distributed_action=False,
    strong_gravity=False,
    node_mass=None,
    node_size=None,
    weight=None,
    dissuade_hubs=False,
    linlog=False,
    seed=None,
    dim=2,
) -> dict[Incomplete, Incomplete]: ...
def rescale_layout(pos, scale: float = 1): ...
def rescale_layout_dict(pos, scale: float = 1): ...
def bfs_layout(G, start, *, align="vertical", scale=1, center=None) -> dict[Incomplete, Incomplete]: ...
