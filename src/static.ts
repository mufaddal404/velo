import { join, resolve, normalize, sep, extname } from "node:path";
import { statSync, createReadStream, existsSync } from "node:fs";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { createHash } from "node:crypto";

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

import { type Context } from "./middleware.js";

export const staticFiles: Plugin<StaticOptions> = (app, options) => {
  const root = resolve(options.root);
  const prefix = options.prefix || "/";
  const index = options.index || "index.html";
  const dotFiles = options.dotFiles || "deny";
  const maxAge = options.maxAge || 0;
  const useEtag = options.etag !== false;

  app.get(prefix + "*", async (ctx: Context) => {
    if (ctx.req.path.includes("..")) {
      throw new ForbiddenError("Path traversal detected");
    }
    let path = ctx.req.path.slice(prefix.length);
    if (path.startsWith("/")) path = path.slice(1);

    // Path traversal protection
    const fullPath = normalize(join(root, path));
    if (!fullPath.startsWith(root)) {
      throw new ForbiddenError("Path traversal detected");
    }

    // Dotfiles protection
    const parts = path.split(sep);
    if (parts.some((p: string) => p.startsWith("."))) {
      if (dotFiles === "deny") throw new ForbiddenError("Access to dotfiles is denied");
      if (dotFiles === "ignore") throw new NotFoundError();
    }

    let stats;
    let targetFile = fullPath;
    try {
      stats = statSync(targetFile);
      if (stats.isDirectory()) {
        targetFile = join(targetFile, index);
        stats = statSync(targetFile);
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
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size || end >= stats.size) {
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
