import { type Middleware } from "./middleware.js";

interface RouteResult {
  handlers: Middleware[];
  params: Record<string, string>;
}

class Node {
  path: string;
  children: Node[] = [];
  indices: string = "";
  paramChild?: Node;
  paramName?: string;
  wildcardHandlers = new Map<string, Middleware[]>();
  handlers = new Map<string, Middleware[]>();

  constructor(path: string = "") {
    this.path = path;
  }
}

export class Router {
  private root = new Node();

  add(method: string, path: string, handlers: Middleware[]) {
    const methodUpper = method.toUpperCase();
    this._add(this.root, path, methodUpper, handlers);
  }

  private _add(node: Node, path: string, method: string, handlers: Middleware[]) {
    if (path === "") {
      node.handlers.set(method, handlers);
      return;
    }

    if (path.startsWith(":")) {
      let end = path.indexOf("/");
      if (end === -1) end = path.length;
      const paramName = path.slice(1, end);
      if (node.paramChild) {
        if (node.paramName !== paramName) {
          throw new Error(`Route conflict: parameter name mismatch. Expected ":${node.paramName}" but got ":${paramName}" at "${path}"`);
        }
      } else {
        node.paramChild = new Node();
        node.paramName = paramName;
      }
      this._add(node.paramChild, path.slice(end), method, handlers);
      return;
    }

    if (path.startsWith("*")) {
      node.wildcardHandlers.set(method, handlers);
      return;
    }

    // Static
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const cpLen = this._getCommonPrefixLen(child.path, path);
      if (cpLen > 0) {
        if (cpLen < child.path.length) {
          // Split child
          const newNode = new Node(child.path.slice(cpLen));
          newNode.children = child.children;
          newNode.indices = child.indices;
          newNode.paramChild = child.paramChild;
          newNode.paramName = child.paramName;
          newNode.handlers = new Map(child.handlers);
          newNode.wildcardHandlers = new Map(child.wildcardHandlers);

          child.path = child.path.slice(0, cpLen);
          child.children = [newNode];
          child.indices = newNode.path[0];
          child.paramChild = undefined;
          child.paramName = undefined;
          child.handlers = new Map();
          child.wildcardHandlers = new Map();
        }
        this._add(child, path.slice(cpLen), method, handlers);
        return;
      }
    }

    // No common prefix with any child, create new static child
    let end = path.search(/[:*]/);
    if (end === -1) end = path.length;
    const newNode = new Node(path.slice(0, end));
    node.children.push(newNode);
    node.indices += newNode.path[0];
    this._add(newNode, path.slice(end), method, handlers);
  }

  private _getCommonPrefixLen(a: string, b: string): number {
    let len = 0;
    const max = Math.min(a.length, b.length);
    while (len < max && a[len] === b[len]) {
      len++;
    }
    return len;
  }

  match(method: string, path: string): { result: RouteResult | null; methodNotAllowed: boolean } {
    const methodUpper = method.toUpperCase();
    let methodMatched = false;
    let finalResult: RouteResult | null = null;

    const search = (node: Node, currentPath: string, params: Record<string, string>): boolean => {
      if (!currentPath.startsWith(node.path)) return false;

      const remaining = currentPath.slice(node.path.length);

      if (remaining === "") {
        const h = node.handlers.get(methodUpper) || node.handlers.get("ALL");
        if (h) {
          finalResult = { handlers: h, params: { ...params } };
          return true;
        }
        if (node.handlers.size > 0 || node.handlers.has("ALL")) methodMatched = true;

        const wh = node.wildcardHandlers.get(methodUpper) || node.wildcardHandlers.get("ALL");
        if (wh) {
          finalResult = { handlers: wh, params: { ...params, "*": "" } };
          return true;
        }
        if (node.wildcardHandlers.size > 0 || node.wildcardHandlers.has("ALL")) methodMatched = true;

        return false;
      }

      // Check wildcard match (matches anything remaining)
      const wh = node.wildcardHandlers.get(methodUpper) || node.wildcardHandlers.get("ALL");
      if (wh) {
        finalResult = { handlers: wh, params: { ...params, "*": remaining } };
      }
      if (node.wildcardHandlers.size > 0 || node.wildcardHandlers.has("ALL")) methodMatched = true;

      // Try static children
      const char = remaining[0];
      for (const child of node.children) {
        if (child.path[0] === char) {
          if (search(child, remaining, params)) return true;
        }
      }

      // Try param child
      if (node.paramChild) {
        let end = remaining.indexOf("/");
        if (end === -1) end = remaining.length;
        const val = remaining.slice(0, end);
        if (search(node.paramChild, remaining.slice(end), { ...params, [node.paramName!]: val })) return true;
      }

      return !!finalResult && finalResult.params["*"] !== undefined;
    };

    search(this.root, path, {});

    return { result: finalResult, methodNotAllowed: !finalResult && methodMatched };
  }
}
