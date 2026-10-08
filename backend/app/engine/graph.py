import networkx as nx
from app.models import Scenario

def build_graph(scenario: Scenario) -> nx.DiGraph:
    G = nx.DiGraph()
    for node in scenario.nodes:
        # Convert node model to dict
        attrs = node.model_dump(exclude_none=True)
        node_id = attrs.pop("id")
        G.add_node(node_id, **attrs)

    for edge in scenario.edges:
        # Convert edge model to dict
        attrs = edge.model_dump(by_alias=True, exclude_none=True)
        u = attrs.pop("from")
        v = attrs.pop("to")
        G.add_edge(u, v, **attrs)

    return G
