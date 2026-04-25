import { join, resolve, normalize, sep, extname } from "node:path";
import { createReadStream, promises as fs } from "node:fs";
import { PassThrough } from "node:stream";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { type Plugin } from "./plugin.js";
import { type Context } from "./middleware.js";
import { type Readable } from "node:stream";

export interface StaticOptions {
  root: string;
  prefix?: string;
  index?: string;
  dotFiles?: "deny" | "ignore" | "allow";
  maxAge?: number;
  etag?: boolean;
  maxRanges?: number;
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
  const maxRanges = options.maxRanges || 10;

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
    const rangeHeader = ctx.req.header("range");
    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const ranges: { start: number; end: number }[] = [];
      const rangeSpecs = rangeHeader.slice(6).split(",");
      
      for (const spec of rangeSpecs) {
        const parts = spec.split("-");
        if (parts.length !== 2) continue;
        
        const startStr = parts[0].trim();
        const endStr = parts[1].trim();
        let start: number;
        let end: number;
        
        if (startStr === "") {
          const suffix = parseInt(endStr, 10);
          if (isNaN(suffix)) continue;
          start = Math.max(0, stats.size - suffix);
          end = stats.size - 1;
        } else {
          start = parseInt(startStr, 10);
          if (isNaN(start)) continue;
          if (endStr === "") {
            end = stats.size - 1;
          } else {
            end = parseInt(endStr, 10);
            if (isNaN(end)) continue;
          }
        }
        
        if (start < stats.size && start <= end) {
          ranges.push({ start, end: Math.min(end, stats.size - 1) });
        }
      }

      if (ranges.length > maxRanges) {
        ctx.res.status(400).send("Too many ranges");
        return;
      }

      if (ranges.length === 0) {
        ctx.res.status(416).set("Content-Range", `bytes */${stats.size}`).send();
        return;
      }

      if (ranges.length === 1) {
        const { start, end } = ranges[0];
        ctx.res.status(206);
        ctx.res.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
        ctx.res.set("Content-Length", (end - start + 1).toString());
        ctx.res.stream(createReadStream(targetFile, { start, end }));
      } else {
        const boundary = `VELO_BOUNDARY_${Date.now().toString(36)}`;
        const contentType = ctx.res.get("content-type") || "application/octet-stream";
        
        ctx.res.status(206);
        ctx.res.set("Content-Type", `multipart/byteranges; boundary=${boundary}`);
        
        const out = new PassThrough();
        ctx.res.stream(out);
        
        const write = async (chunk: any) => {
          if (!out.write(chunk)) {
            await new Promise((resolve) => out.once("drain", resolve));
          }
        };

        (async () => {
          try {
            for (const { start, end } of ranges) {
              await write(`--${boundary}\r\n`);
              await write(`Content-Type: ${contentType}\r\n`);
              await write(`Content-Range: bytes ${start}-${end}/${stats.size}\r\n\r\n`);
              
              const stream = createReadStream(targetFile, { start, end });
              for await (const chunk of stream) {
                await write(chunk);
              }
              await write("\r\n");
            }
            out.end(`--${boundary}--\r\n`);
          } catch (err) {
            out.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      }
    } else {
      ctx.res.set("Content-Length", stats.size.toString());
      ctx.res.stream(createReadStream(targetFile));
    }
  });
};
