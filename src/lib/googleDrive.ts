/**
 * Google Drive Multi-Account Storage Manager
 *
 * Architecture:
 *  - Multiple Google Drive accounts supported
 *  - Auto-routes uploads to the drive with most free space
 *  - Files are made publicly readable so download works without auth
 *  - Only metadata (driveFileId, accountId) stored in Supabase
 *  - OAuth uses Google Identity Services (GIS) – client_id only, no secret
 *  - All Drive API calls happen client-side via fetch (no backend needed)
 *
 * Setup:
 *  1. Create a Google Cloud project at https://console.cloud.google.com
 *  2. Enable the Google Drive API
 *  3. Create OAuth 2.0 credentials → Web application
 *  4. Add your app's origin to Authorised JavaScript origins
 *  5. Copy the Client ID into Settings → Drive Accounts in the app
 *
 * SQL to run in Supabase SQL Editor before using:
 *  See the SQL block at the bottom of this file.
 */

import { supabase } from "./supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriveAccount {
  id: string;
  email: string;
  displayName: string;
  accessToken: string;
  tokenExpiry: number;
  storageTotal: number;   // bytes, 0 = unlimited/unknown
  storageUsed: number;    // bytes
  storageFree: number;    // computed
  connected: boolean;
  rootFolderId?: string;  // "JEE Prep Pro" folder in this Drive
}

export interface DriveUploadResult {
  driveFileId: string;
  accountId: string;
  downloadUrl: string;
  viewUrl: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks

// ─── Google Identity Services OAuth ──────────────────────────────────────────

let gisLoaded = false;
function loadGIS(): Promise<void> {
  if (gisLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    if ((window as any).google?.accounts?.oauth2) { gisLoaded = true; resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => { gisLoaded = true; resolve(); };
    document.head.appendChild(s);
  });
}

async function fetchUserInfo(accessToken: string): Promise<{ email: string; name: string }> {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("Failed to get user info");
  const d = await r.json();
  return { email: d.email, name: d.name ?? d.email };
}

// Request a fresh OAuth access token from the user's browser
export function requestDriveToken(clientId: string): Promise<{ token: string; email: string; name: string }> {
  return loadGIS().then(
    () =>
      new Promise((resolve, reject) => {
        const tc = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: async (resp: any) => {
            if (resp.error) { reject(new Error(resp.error_description ?? resp.error)); return; }
            try {
              const info = await fetchUserInfo(resp.access_token);
              resolve({ token: resp.access_token, ...info });
            } catch (e) { reject(e); }
          },
        });
        tc.requestAccessToken({ prompt: "select_account" });
      })
  );
}

// ─── Drive API helpers ────────────────────────────────────────────────────────

async function driveJSON(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `Drive API ${r.status}`;
    try { msg = JSON.parse(text).error?.message ?? msg; } catch {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

async function getQuota(token: string): Promise<{ total: number; used: number }> {
  const d = await driveJSON(token, `${API}/about?fields=storageQuota`);
  return {
    total: Number(d.storageQuota?.limit ?? 15 * 1024 * 1024 * 1024),
    used: Number(d.storageQuota?.usage ?? 0),
  };
}

async function ensureFolder(token: string, existingId?: string): Promise<string> {
  // Verify existing folder
  if (existingId) {
    try {
      await driveJSON(token, `${API}/files/${existingId}?fields=id&trashed=false`);
      return existingId;
    } catch {}
  }
  // Search
  const res = await driveJSON(
    token,
    `${API}/files?q=${encodeURIComponent("name='JEE Prep Pro' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id)&spaces=drive`
  );
  if (res.files?.length > 0) return res.files[0].id;
  // Create
  const f = await driveJSON(token, `${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "JEE Prep Pro", mimeType: "application/vnd.google-apps.folder" }),
  });
  return f.id;
}

async function setPublic(token: string, fileId: string): Promise<void> {
  await fetch(`${API}/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

// Simple multipart upload (≤5 MB)
async function simpleUpload(
  token: string,
  folderId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<{ id: string; webContentLink: string; webViewLink: string }> {
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const boundary = "---drive_boundary_" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const ending = `\r\n--${boundary}--`;

  const blob = new Blob([body, file, ending]);
  onProgress?.({ loaded: 0, total: file.size, percent: 0 });

  const r = await fetch(`${UPLOAD_API}?uploadType=multipart&fields=id,webContentLink,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: blob,
  });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
  return r.json();
}

// Resumable chunked upload (>5 MB)
async function resumableUpload(
  token: string,
  folderId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<{ id: string; webContentLink: string; webViewLink: string }> {
  // Initiate session
  const init = await fetch(`${UPLOAD_API}?uploadType=resumable&fields=id,webContentLink,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": file.type || "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!init.ok) throw new Error(`Resumable init failed: ${init.status}`);
  const sessionUrl = init.headers.get("Location")!;

  let offset = 0;
  let result: any;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const r = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: chunk,
    });
    onProgress?.({ loaded: end, total: file.size, percent: Math.round((end / file.size) * 100) });
    if (r.status === 200 || r.status === 201) {
      result = await r.json();
    } else if (r.status === 308) {
      // Incomplete — continue
    } else {
      throw new Error(`Chunk upload failed: ${r.status}`);
    }
    offset = end;
  }

  return result;
}

// Public upload entry point
export async function uploadFileToDrive(
  token: string,
  folderId: string,
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<{ driveFileId: string; downloadUrl: string; viewUrl: string }> {
  const raw =
    file.size > 5 * 1024 * 1024
      ? await resumableUpload(token, folderId, file, onProgress)
      : await simpleUpload(token, folderId, file, onProgress);

  await setPublic(token, raw.id);

  const downloadUrl =
    raw.webContentLink ??
    `https://drive.google.com/uc?export=download&id=${raw.id}`;
  const viewUrl =
    raw.webViewLink ?? `https://drive.google.com/file/d/${raw.id}/view`;

  return { driveFileId: raw.id, downloadUrl, viewUrl };
}

// Delete a file from Drive
export async function deleteFileFromDrive(token: string, driveFileId: string): Promise<void> {
  await fetch(`${API}/files/${driveFileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Get a direct download URL (works for publicly-shared files without auth)
export function getDriveDirectUrl(driveFileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
}

// ─── Multi-Account Manager ────────────────────────────────────────────────────

export class DriveManager {
  private cache: Map<string, DriveAccount> = new Map();
  clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  // ── Supabase I/O ──

  async loadAccounts(): Promise<DriveAccount[]> {
    const { data } = await supabase.from("drive_accounts").select("*").order("created_at");
    const rows = data ?? [];
    const accounts: DriveAccount[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name ?? r.email,
      accessToken: r.access_token ?? "",
      tokenExpiry: Number(r.token_expiry ?? 0),
      storageTotal: Number(r.storage_total ?? 15 * 1024 * 1024 * 1024),
      storageUsed: Number(r.storage_used ?? 0),
      storageFree:
        Number(r.storage_total ?? 15 * 1024 * 1024 * 1024) -
        Number(r.storage_used ?? 0),
      connected: !!(r.access_token),
      rootFolderId: r.root_folder_id ?? undefined,
    }));
    accounts.forEach((a) => this.cache.set(a.id, a));
    return accounts;
  }

  // ── OAuth connect ──

  async connectAccount(): Promise<DriveAccount> {
    if (!this.clientId) throw new Error("Google Client ID not configured. Please add it in Settings → Drive Accounts.");
    const { token, email, name } = await requestDriveToken(this.clientId);
    const quota = await getQuota(token);
    const folderId = await ensureFolder(token);

    const id = crypto.randomUUID();
    const expiry = Date.now() + 3500 * 1000; // ~1 hr
    const { error } = await supabase.from("drive_accounts").insert({
      id,
      email,
      display_name: name,
      access_token: token,
      token_expiry: expiry,
      storage_total: quota.total,
      storage_used: quota.used,
      root_folder_id: folderId,
    });
    if (error) throw error;

    const account: DriveAccount = {
      id,
      email,
      displayName: name,
      accessToken: token,
      tokenExpiry: expiry,
      storageTotal: quota.total,
      storageUsed: quota.used,
      storageFree: quota.total - quota.used,
      connected: true,
      rootFolderId: folderId,
    };
    this.cache.set(id, account);
    return account;
  }

  // ── Remove account ──

  async disconnectAccount(id: string): Promise<void> {
    await supabase.from("drive_accounts").delete().eq("id", id);
    this.cache.delete(id);
  }

  // ── Auto-routing ──

  getBestAccount(fileSize: number): DriveAccount | null {
    let best: DriveAccount | null = null;
    for (const a of this.cache.values()) {
      if (!a.connected || !a.accessToken) continue;
      if (a.storageTotal > 0 && a.storageFree < fileSize) continue;
      if (!best || a.storageFree > best.storageFree) best = a;
    }
    return best;
  }

  // ── Upload ──

  async upload(
    file: File,
    onProgress?: (p: UploadProgress) => void
  ): Promise<DriveUploadResult> {
    const account = this.getBestAccount(file.size);
    if (!account)
      throw new Error(
        "No Google Drive account with enough free space. Connect a new Drive account in Settings."
      );

    await this.ensureFreshToken(account);
    const folderId = account.rootFolderId ?? (await ensureFolder(account.accessToken));

    const { driveFileId, downloadUrl, viewUrl } = await uploadFileToDrive(
      account.accessToken,
      folderId,
      file,
      onProgress
    );

    // Update storage estimate in Supabase
    const newUsed = account.storageUsed + file.size;
    await supabase
      .from("drive_accounts")
      .update({ storage_used: newUsed })
      .eq("id", account.id);

    // Update cache
    const updated = { ...account, storageUsed: newUsed, storageFree: account.storageTotal - newUsed };
    this.cache.set(account.id, updated);

    return { driveFileId, accountId: account.id, downloadUrl, viewUrl };
  }

  // ── Delete ──

  async deleteFile(accountId: string, driveFileId: string, fileSize = 0): Promise<void> {
    const account = this.cache.get(accountId);
    if (!account) throw new Error("Drive account not found");
    await this.ensureFreshToken(account);
    await deleteFileFromDrive(account.accessToken, driveFileId);

    const newUsed = Math.max(0, account.storageUsed - fileSize);
    await supabase.from("drive_accounts").update({ storage_used: newUsed }).eq("id", accountId);
    this.cache.set(accountId, { ...account, storageUsed: newUsed, storageFree: account.storageTotal - newUsed });
  }

  // ── Refresh quota ──

  async refreshQuota(accountId: string): Promise<DriveAccount | undefined> {
    const account = this.cache.get(accountId);
    if (!account) return;
    await this.ensureFreshToken(account);
    const quota = await getQuota(account.accessToken);
    const updated = { ...account, storageTotal: quota.total, storageUsed: quota.used, storageFree: quota.total - quota.used };
    this.cache.set(accountId, updated);
    await supabase.from("drive_accounts").update({ storage_total: quota.total, storage_used: quota.used }).eq("id", accountId);
    return updated;
  }

  // ── Token management ──

  private async ensureFreshToken(account: DriveAccount): Promise<void> {
    if (account.tokenExpiry > Date.now() + 120_000) return; // 2 min buffer
    // GIS implicit tokens can't be silently refreshed — re-prompt
    const { token } = await requestDriveToken(this.clientId);
    account.accessToken = token;
    account.tokenExpiry = Date.now() + 3500 * 1000;
    await supabase.from("drive_accounts").update({
      access_token: token,
      token_expiry: account.tokenExpiry,
    }).eq("id", account.id);
  }

  getAccount(id: string): DriveAccount | undefined {
    return this.cache.get(id);
  }

  getAll(): DriveAccount[] {
    return Array.from(this.cache.values());
  }

  get totalFree(): number {
    return Array.from(this.cache.values()).reduce((s, a) => s + a.storageFree, 0);
  }

  get totalCapacity(): number {
    return Array.from(this.cache.values()).reduce((s, a) => s + a.storageTotal, 0);
  }
}

// ─── Singleton factory (lazy) ─────────────────────────────────────────────────
let _manager: DriveManager | null = null;
export function getDriveManager(clientId: string): DriveManager {
  if (!_manager || _manager.clientId !== clientId) {
    _manager = new DriveManager(clientId);
  }
  return _manager;
}

/*
 * ─── SQL to run in Supabase SQL Editor ────────────────────────────────────────
 *
 * Run these once before enabling Google Drive storage:
 *
 * -- 1. Drive accounts table
 * CREATE TABLE IF NOT EXISTS public.drive_accounts (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   email TEXT NOT NULL UNIQUE,
 *   display_name TEXT,
 *   access_token TEXT,
 *   token_expiry BIGINT DEFAULT 0,
 *   storage_total BIGINT DEFAULT 16106127360,
 *   storage_used BIGINT DEFAULT 0,
 *   root_folder_id TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * ALTER TABLE public.drive_accounts DISABLE ROW LEVEL SECURITY;
 * GRANT ALL ON public.drive_accounts TO anon;
 *
 * -- 2. Add Drive columns to existing files table
 * ALTER TABLE public.files
 *   ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
 *   ADD COLUMN IF NOT EXISTS drive_account_id UUID;
 *
 */
