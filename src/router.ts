type Handler = any; // Will be defined in middleware.ts

interface RouteResult {
  handlers: Handler[];
  params: Record<string, string>;
}

class Node {
  static = new Map<string, Node>();
  param?: Node;
  wildcard?: Handler[];
  handlers = new Map<string, Handler[]>();
  paramName?: string;
  hasWildcard = false;
}

export class Router {
  private root = new Node();

  add(method: string, path: string, handlers: Handler[]) {
    const segments = path.split("/").filter(Boolean);
    let current = this.root;

    for (const segment of segments) {
      if (segment.startsWith(":")) {
        if (!current.param) current.param = new Node();
        current = current.param;
        current.paramName = segment.slice(1);
      } else if (segment === "*") {
        current.wildcard = handlers;
        current.hasWildcard = true;
        break;
      } else {
        if (!current.static.has(segment)) {
          current.static.set(segment, new Node());
        }
        current = current.static.get(segment)!;
      }
    }

    if (!path.endsWith("*")) {
      current.handlers.set(method.toUpperCase(), handlers);
    }
  }

  match(method: string, path: string): { result: RouteResult | null; methodNotAllowed: boolean } {
    const segments = path.split("/").filter(Boolean);
    const params: Record<string, string> = {};
    
    // First, find any node that matches the path regardless of method
    const nodes = this._findAllNodes(this.root, segments, 0, params);
    
    if (nodes.length === 0) {
      return { result: null, methodNotAllowed: false };
    }

    const methodUpper = method.toUpperCase();
    for (const { node, params: matchParams } of nodes) {
      const handlers = node.handlers.get(methodUpper) || node.handlers.get("ALL") || (node.wildcard && node.hasWildcard ? node.wildcard : null);
      if (handlers) {
        return { result: { handlers, params: matchParams }, methodNotAllowed: false };
      }
    }

    return { result: null, methodNotAllowed: true };
  }

  private _findAllNodes(
    node: Node,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): { node: Node; params: Record<string, string> }[] {
    if (index === segments.length) {
      return [{ node, params: { ...params } }];
    }

    const segment = segments[index];
    const matches: { node: Node; params: Record<string, string> }[] = [];

    // 1. Static match
    const staticNode = node.static.get(segment);
    if (staticNode) {
      matches.push(...this._findAllNodes(staticNode, segments, index + 1, params));
    }

    // 2. Param match
    if (node.param) {
      const nextParams = { ...params, [node.param.paramName!]: segment };
      matches.push(...this._findAllNodes(node.param, segments, index + 1, nextParams));
    }

    // 3. Wildcard match (it's terminal and matches everything else)
    if (node.wildcard) {
      matches.push({ node, params: { ...params, "*": segments.slice(index).join("/") } });
    }

    return matches;
  }
}
