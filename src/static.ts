import { join, resolve, normalize, sep, extname, posix } from "node:path";
import { createReadStream, promises as fs } from "node:fs";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { type Context } from "./middleware.js";

export interface StaticOptions {
  root: string;
  prefix?: string;
  index?: string;
  dotFiles?: "deny" | "ignore" | "allow";
  maxAge?: number;
  etag?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".ts": "application/x-typescript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

export const staticFiles: Plugin<StaticOptions> = (app, options) => {
  const root = resolve(options.root);
  const prefix = options.prefix || "/";
  const index = options.index || "index.html";
  const dotFiles = options.dotFiles || "deny";
  const maxAge = options.maxAge || 0;
  const useEtag = options.etag !== false;

  const routePrefix = prefix.endsWith("/") ? prefix : prefix + "/";
  app.get(routePrefix + "*", async (ctx: Context) => {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(ctx.req.path);
    } catch (e) {
      ctx.res.status(400).send("Invalid URI");
      return;
    }

    if (decodedPath.includes("..")) {
      throw new ForbiddenError("Path traversal detected");
    }
    
    // Use posix for URL paths to avoid Windows-specific separator issues
    let path = decodedPath.slice(prefix.length);
    if (path.startsWith("/")) path = path.slice(1);

    // Path traversal protection
    const fullPath = normalize(join(root, path));
    if (!(fullPath === root || fullPath.startsWith(root + sep))) {
      throw new ForbiddenError("Path traversal detected");
    }

    // Dotfiles protection using posix path parts since URL paths always use /
    const parts = path.split("/");
    if (parts.some((p) => p.startsWith("."))) {
      if (dotFiles === "deny") throw new ForbiddenError("Access to dotfiles is denied");
      if (dotFiles === "ignore") throw new NotFoundError();
    }

    let stats;
    let targetFile = fullPath;
    try {
      stats = await fs.stat(targetFile);
      if (stats.isDirectory()) {
        targetFile = join(targetFile, index);
        stats = await fs.stat(targetFile);
      }
    } catch (e) {
      throw new NotFoundError();
    }

    if (!stats.isFile()) throw new NotFoundError();

    // Headers
    const ext = extname(targetFile);
    ctx.res.type(MIME_TYPES[ext] || "application/octet-stream");
    ctx.res.set("Cache-Control", `public, max-age=${maxAge}`);

    // ETag
    let etag = "";
    if (useEtag) {
      etag = `W/"${stats.size}-${stats.mtime.getTime()}"`;
      ctx.res.set("ETag", etag);

      if (ctx.req.header("if-none-match") === etag) {
        ctx.res.status(304).send();
        return;
      }
    }

    // Range
    const range = ctx.req.header("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start: number;
      let end: number;

      if (parts[0] === "") {
        // Suffix range: bytes=-500
        const suffix = parseInt(parts[1], 10);
        if (isNaN(suffix)) {
          ctx.res.status(416).set("Content-Range", `bytes */${stats.size}`).send();
          return;
        }
        start = Math.max(0, stats.size - suffix);
        end = stats.size - 1;
      } else {
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      }

      if (isNaN(start) || isNaN(end) || start >= stats.size || end >= stats.size || start > end) {
        ctx.res.status(416).set("Content-Range", `bytes */${stats.size}`).send();
        return;
      }

      ctx.res.status(206);
      ctx.res.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      ctx.res.set("Content-Length", (end - start + 1).toString());
      ctx.res.stream(createReadStream(targetFile, { start, end }));
    } else {
      ctx.res.set("Content-Length", stats.size.toString());
      ctx.res.stream(createReadStream(targetFile));
    }
  });
};
