import crypto from "crypto";
import { supabaseServer } from "../services/supabaseClient";
import type { Context } from "../context";

const ALLOWED_MIME_PREFIXES = ["image/", "video/", "application/pdf"];
const MAX_SIZE_BYTES = 30 * 1024 * 1024;

function isMimeAllowed(mime: string): boolean {
  if (mime === "application/pdf") return true;
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

function safeFilename(filename: string): string {
  const base = filename.replace(/[/\\]/g, "_").normalize("NFKC");
  return base.slice(0, 200);
}
async function findUserIdByEmail(email: string): Promise<string | null> {
  // Supabase auth users are in auth.users; need service role and RPC or admin API.
  // Simplest: use Supabase Admin API via supabaseServer.auth.admin.
  const { data, error } = await supabaseServer.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error || !data) return null;
  const user = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  return user?.id ?? null;
}

export const resolvers = {
  Query: {
    _ping: () => "ok",

    async myAssets(
      _parent: unknown,
      args: { after?: string | null; first?: number | null; q?: string | null },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const limit =
        args.first && args.first > 0 && args.first <= 50 ? args.first : 20;

      let query = supabaseServer
        .from("asset")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit + 1);

      if (args.after) {
        query = query.lt("created_at", args.after);
      }

      // simple owner or shared, RLS already enforces
      // optional text search on filename
      if (args.q && args.q.trim().length) {
        query = query.ilike("filename", `%${args.q.trim()}%`);
      }

      const { data, error } = await query;
      if (error) {
        throw Object.assign(new Error("Failed to load assets"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      const hasNextPage = (data ?? []).length > limit;
      const slice = hasNextPage ? data.slice(0, limit) : data;
      const endCursor = slice.length
        ? slice[slice.length - 1].created_at
        : null;

      return {
        edges: slice.map((row: any) => ({
          cursor: row.created_at,
          node: {
            id: row.id,
            filename: row.filename,
            mime: row.mime,
            size: row.size,
            sha256: row.sha256,
            status: row.status,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        })),
        pageInfo: {
          endCursor,
          hasNextPage,
        },
      };
    },
  },

  Mutation: {
    async createUploadUrl(
      _parent: unknown,
      args: { filename: string; mime: string; size: number },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const { filename, mime, size } = args;

      if (!isMimeAllowed(mime)) {
        throw Object.assign(new Error("MIME not allowed"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      if (size <= 0 || size > MAX_SIZE_BYTES) {
        throw Object.assign(new Error("Invalid size"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      const assetId = crypto.randomUUID();
      const nonce = crypto.randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

      const safeName = safeFilename(filename);
      const storagePath = `private/${
        ctx.userId
      }/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(
        2,
        "0"
      )}/${assetId}-${safeName}`;

      const { error: assetErr } = await supabaseServer.from("asset").insert({
        id: assetId,
        owner_id: ctx.userId,
        filename: safeName,
        mime,
        size,
        storage_path: storagePath,
        status: "uploading",
        version: 1,
      });
      if (assetErr) {
        throw Object.assign(new Error("Failed to create asset"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      const { error: ticketErr } = await supabaseServer
        .from("upload_ticket")
        .insert({
          asset_id: assetId,
          user_id: ctx.userId,
          nonce,
          mime,
          size,
          storage_path: storagePath,
          expires_at: expiresAt.toISOString(),
          used: false,
        });
      if (ticketErr) {
        throw Object.assign(new Error("Failed to create ticket"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }
      const BUCKET = "private";

      const { data: signed, error: signedErr } = await supabaseServer.storage
        .from(BUCKET) // or your real bucket name
        .createSignedUploadUrl(storagePath);

      if (signedErr || !signed) {
        console.error("createSignedUploadUrl error:", signedErr);
        throw Object.assign(new Error("Failed to create uploadUrl"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }
      return {
        assetId,
        storagePath,
        uploadUrl: signed.signedUrl,
        expiresAt: expiresAt.toISOString(),
        nonce,
      };
    },

    //finalize upload
    async finalizeUpload(
      _parent: unknown,
      args: { assetId: string; clientSha256: string; version: number },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const { assetId, clientSha256, version } = args;

      // 1) Load asset (RLS ensures only owner / shared can see)
      const { data: asset, error: assetErr } = await supabaseServer
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .single();

      if (assetErr || !asset) {
        throw Object.assign(new Error("Asset not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (asset.owner_id !== ctx.userId) {
        throw Object.assign(new Error("Forbidden"), {
          extensions: { code: "FORBIDDEN" },
        });
      }

      if (asset.version !== version) {
        throw Object.assign(new Error("Version conflict"), {
          extensions: { code: "VERSION_CONFLICT" },
        });
      }

      // 2) Load ticket
      const { data: ticket, error: ticketErr } = await supabaseServer
        .from("upload_ticket")
        .select("*")
        .eq("asset_id", assetId)
        .single();

      if (ticketErr || !ticket) {
        throw Object.assign(new Error("Ticket not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (ticket.user_id !== ctx.userId) {
        throw Object.assign(new Error("Forbidden"), {
          extensions: { code: "FORBIDDEN" },
        });
      }

      if (ticket.used) {
        // idempotent finalize: just return current asset
        return {
          id: asset.id,
          filename: asset.filename,
          mime: asset.mime,
          size: asset.size,
          sha256: asset.sha256,
          status: asset.status,
          version: asset.version,
          createdAt: asset.created_at,
          updatedAt: asset.updated_at,
        };
      }

      if (new Date(ticket.expires_at) < new Date()) {
        throw Object.assign(new Error("Ticket expired"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      // 3) Call Edge Function to hash object 
      
      const { data: fileData, error: downloadErr } =
        await supabaseServer.storage
          .from("private")
          .download(ticket.storage_path);

      if (downloadErr || !fileData) {
        await supabaseServer
          .from("asset")
          .update({ status: "corrupt" })
          .eq("id", assetId);

        throw Object.assign(new Error("Object missing"), {
          extensions: { code: "INTEGRITY_ERROR" },
        });
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const serverHash = crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");

      const status = serverHash === clientSha256 ? "ready" : "corrupt";

      // 4) Update asset & mark ticket used
      const { data: updated, error: updateErr } = await supabaseServer
        .from("asset")
        .update({
          sha256: serverHash,
          status,
          version: version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assetId)
        .select("*")
        .single();

      if (updateErr || !updated) {
        throw Object.assign(new Error("Failed to update asset"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      await supabaseServer
        .from("upload_ticket")
        .update({ used: true })
        .eq("asset_id", assetId);

      if (status !== "ready") {
        throw Object.assign(new Error("Hash mismatch"), {
          extensions: { code: "INTEGRITY_ERROR" },
        });
      }

      return {
        id: updated.id,
        filename: updated.filename,
        mime: updated.mime,
        size: updated.size,
        sha256: updated.sha256,
        status: updated.status,
        version: updated.version,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    },
    async shareAsset(
      _parent: unknown,
      args: {
        assetId: string;
        toEmail: string;
        canDownload: boolean;
        version: number;
      },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const { assetId, toEmail, canDownload, version } = args;

      // 1) Load asset & check owner + version
      const { data: asset, error: assetErr } = await supabaseServer
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .single();

      if (assetErr || !asset) {
        throw Object.assign(new Error("Asset not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (asset.owner_id !== ctx.userId) {
        throw Object.assign(new Error("Forbidden"), {
          extensions: { code: "FORBIDDEN" },
        });
      }

      if (asset.version !== version) {
        throw Object.assign(new Error("Version conflict"), {
          extensions: { code: "VERSION_CONFLICT" },
        });
      }

      // 2) Lookup target user by email
      const toUserId = await findUserIdByEmail(toEmail);
      if (!toUserId) {
        throw Object.assign(new Error("User not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (toUserId === ctx.userId) {
        // no-op for sharing to self
        return {
          id: asset.id,
          filename: asset.filename,
          mime: asset.mime,
          size: asset.size,
          sha256: asset.sha256,
          status: asset.status,
          version: asset.version,
          createdAt: asset.created_at,
          updatedAt: asset.updated_at,
        };
      }

      // 3) Upsert into asset_share
      const { error: shareErr } = await supabaseServer
        .from("asset_share")
        .upsert(
          {
            asset_id: assetId,
            to_user: toUserId,
            can_download: canDownload,
          },
          { onConflict: "asset_id,to_user" }
        );

      if (shareErr) {
        throw Object.assign(new Error("Failed to share asset"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      // 4) Bump version on asset (versioned writes)
      const { data: updated, error: updErr } = await supabaseServer
        .from("asset")
        .update({
          version: asset.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assetId)
        .select("*")
        .single();

      if (updErr || !updated) {
        throw Object.assign(new Error("Failed to update asset version"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      return {
        id: updated.id,
        filename: updated.filename,
        mime: updated.mime,
        size: updated.size,
        sha256: updated.sha256,
        status: updated.status,
        version: updated.version,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    },

    async revokeShare(
      _parent: unknown,
      args: { assetId: string; toEmail: string; version: number },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const { assetId, toEmail, version } = args;

      const { data: asset, error: assetErr } = await supabaseServer
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .single();

      if (assetErr || !asset) {
        throw Object.assign(new Error("Asset not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (asset.owner_id !== ctx.userId) {
        throw Object.assign(new Error("Forbidden"), {
          extensions: { code: "FORBIDDEN" },
        });
      }

      if (asset.version !== version) {
        throw Object.assign(new Error("Version conflict"), {
          extensions: { code: "VERSION_CONFLICT" },
        });
      }

      const toUserId = await findUserIdByEmail(toEmail);
      if (!toUserId) {
        // nothing to revoke, but treat as success
      } else {
        await supabaseServer
          .from("asset_share")
          .delete()
          .eq("asset_id", assetId)
          .eq("to_user", toUserId);
      }

      const { data: updated, error: updErr } = await supabaseServer
        .from("asset")
        .update({
          version: asset.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assetId)
        .select("*")
        .single();

      if (updErr || !updated) {
        throw Object.assign(new Error("Failed to update asset version"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      return {
        id: updated.id,
        filename: updated.filename,
        mime: updated.mime,
        size: updated.size,
        sha256: updated.sha256,
        status: updated.status,
        version: updated.version,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    },
    async deleteAsset(
      _parent: unknown,
      args: { assetId: string; version: number },
      ctx: Context
    ) {
      if (!ctx.userId) {
        throw Object.assign(new Error("Unauthenticated"), {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      const { assetId, version } = args;

      const { data: asset, error: assetErr } = await supabaseServer
        .from("asset")
        .select("*")
        .eq("id", assetId)
        .single();

      if (assetErr || !asset) {
        throw Object.assign(new Error("Asset not found"), {
          extensions: { code: "NOT_FOUND" },
        });
      }

      if (asset.owner_id !== ctx.userId) {
        throw Object.assign(new Error("Forbidden"), {
          extensions: { code: "FORBIDDEN" },
        });
      }

      if (asset.version !== version) {
        throw Object.assign(new Error("Version conflict"), {
          extensions: { code: "VERSION_CONFLICT" },
        });
      }

      // simple hard delete; you can switch to soft delete if desired
      const { error: delErr } = await supabaseServer
        .from("asset")
        .delete()
        .eq("id", assetId);

      if (delErr) {
        throw Object.assign(new Error("Failed to delete asset"), {
          extensions: { code: "BAD_REQUEST" },
        });
      }

      return true;
    },
    async getDownloadUrl(
_parent: unknown,
args: { assetId: string },
ctx: Context
) {
if (!ctx.userId) {
throw Object.assign(new Error("Unauthenticated"), {
extensions: { code: "UNAUTHENTICATED" },
});
}

const { assetId } = args;

// Load asset; RLS ensures only owner/shared
const { data: asset, error: assetErr } = await supabaseServer
.from("asset")
.select("*")
.eq("id", assetId)
.single();

if (assetErr || !asset) {
throw Object.assign(new Error("Asset not found"), {
extensions: { code: "NOT_FOUND" },
});
}

// Optional extra check: only owner can get link
if (asset.owner_id !== ctx.userId) {
throw Object.assign(new Error("Forbidden"), {
extensions: { code: "FORBIDDEN" },
});
}

const { data: signed, error: urlErr } = await supabaseServer.storage
.from("private")
.createSignedUrl(asset.storage_path, 120); // 120 seconds

if (urlErr || !signed) {
throw Object.assign(new Error("Failed to create download URL"), {
extensions: { code: "BAD_REQUEST" },
});
}

return signed.signedUrl as string;
},
  },
};
