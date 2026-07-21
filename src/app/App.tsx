import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { getDriveManager, type DriveAccount, type UploadProgress } from "../lib/googleDrive";
import { supabase } from "../lib/supabase";
import {
  LayoutDashboard, BookOpen, ClipboardList, Cloud, Settings,
  Upload, Search, MoreHorizontal, FileText, ImageIcon,
  File, Trash2, Download, Star, ChevronRight, ChevronLeft,
  Plus, Grid3X3, List, HardDrive, Zap, X,
  AlertTriangle, CheckCircle2, FolderOpen, Target,
  BookMarked, Pencil, Check, FlaskConical, Atom, Calculator,
  Layers, Leaf, TestTube, Eye, EyeOff, LogOut, Clock,
  BookCopy, ListTodo, CalendarDays, CalendarCheck,
  ShieldCheck, UserCircle2, RefreshCw, Link2, ExternalLink, Menu, Globe,
  MessageSquare, StarHalf, Send, Trash,
} from "lucide-react";

// ─── Auth ─────────────────────────────────────────────────────────────────────
const AUTHOR = { username: "rudhra chaudhary", password: "rudra@22" };
const SESSION_KEY = "jeeprepro_session";

interface Session { username: string; role: "author" | "user"; }

function simpleHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h.toString(36);
}
function loadSession(): Session | null {
  try { const s = localStorage.getItem(SESSION_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

// Supabase user helpers
async function dbFindUser(username: string): Promise<{ username: string; password_hash: string } | null> {
  const { data } = await supabase.from("app_users").select("username,password_hash").ilike("username", username).limit(1);
  return data?.[0] ?? null;
}
async function dbCreateUser(username: string, passwordHash: string) {
  const { error } = await supabase.from("app_users").insert({ id: crypto.randomUUID(), username, password_hash: passwordHash });
  if (error) throw error;
}
async function dbUsernameExists(username: string): Promise<boolean> {
  const { count } = await supabase.from("app_users").select("id", { count: "exact", head: true }).ilike("username", username);
  return (count ?? 0) > 0;
}

// ─── Profile ──────────────────────────────────────────────────────────────────
const PROFILE_KEY = "jeeprepro_profile";
interface Profile { name: string; batch: string; }
function loadProfile(): Profile {
  try { const r = localStorage.getItem(PROFILE_KEY); if (r) return JSON.parse(r); } catch {}
  return { name: "", batch: "JEE Advanced 2028" };
}
function saveProfile(p: Profile) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

// ─── Theme ────────────────────────────────────────────────────────────────────
const THEME_KEY = "jeeprepro_theme";
const ACCENT_KEY = "jeeprepro_accent";
type ThemeMode = "dark" | "light";
interface AccentColor { id: string; label: string; primary: string; accent: string; ring: string; }
const ACCENT_COLORS: AccentColor[] = [
  { id: "indigo",  label: "Indigo",  primary: "#6366f1", accent: "#818cf8", ring: "#6366f1" },
  { id: "violet",  label: "Violet",  primary: "#7c3aed", accent: "#a78bfa", ring: "#7c3aed" },
  { id: "rose",    label: "Rose",    primary: "#e11d48", accent: "#fb7185", ring: "#e11d48" },
  { id: "cyan",    label: "Cyan",    primary: "#0891b2", accent: "#22d3ee", ring: "#0891b2" },
  { id: "emerald", label: "Emerald", primary: "#059669", accent: "#34d399", ring: "#059669" },
  { id: "amber",   label: "Amber",   primary: "#d97706", accent: "#fbbf24", ring: "#d97706" },
];
function loadTheme(): ThemeMode { return (localStorage.getItem(THEME_KEY) as ThemeMode) || "dark"; }
function loadAccent(): string { return localStorage.getItem(ACCENT_KEY) || "indigo"; }
function applyTheme(mode: ThemeMode, accentId: string) {
  const root = document.documentElement;
  mode === "dark" ? root.classList.add("dark") : root.classList.remove("dark");
  const a = ACCENT_COLORS.find((x) => x.id === accentId) || ACCENT_COLORS[0];
  root.style.setProperty("--primary", a.primary);
  root.style.setProperty("--accent", a.accent);
  root.style.setProperty("--ring", a.ring);
  root.style.setProperty("--sidebar-primary", a.primary);
  root.style.setProperty("--sidebar-ring", a.ring);
  root.style.setProperty("--border", `${a.primary}${mode === "dark" ? "1f" : "24"}`);
}

// ─── Types ────────────────────────────────────────────────────────────────────
type FileType = "pdf" | "image" | "doc" | "video" | "other";
type Page = "dashboard" | "storage" | "trash" | "subjects" | "tests" | "settings" | "books" | "tasks" | "reviews";

interface StoredFile {
  id: string; name: string; type: FileType; size: number;
  subject: string; folder: string;
  uploadedAt: string; trashed: boolean; trashedAt?: string;
  starred: boolean; mimeType: string;
  externalUrl?: string;    // public URL (Supabase Storage or Drive direct link)
  driveFileId?: string;    // Google Drive file ID (new Drive-backed files)
  driveAccountId?: string; // Which Drive account owns this file
}

// ─── Drive Client ID ─────────────────────────────────────────────────────────
const DRIVE_CLIENT_KEY = "jeeprepro_drive_client_id";
function loadDriveClientId() { return localStorage.getItem(DRIVE_CLIENT_KEY) ?? ""; }
function saveDriveClientId(id: string) { localStorage.setItem(DRIVE_CLIENT_KEY, id); }

// ─── Drive Folder Names (virtual G.Drive categories) ─────────────────────────
const DRIVE_FOLDERS_KEY = "jee_drive_folders";
function loadDriveFolderNames(): string[] {
  try { return JSON.parse(localStorage.getItem(DRIVE_FOLDERS_KEY) || '["General"]'); } catch { return ["General"]; }
}
function saveDriveFolderNames(f: string[]) { localStorage.setItem(DRIVE_FOLDERS_KEY, JSON.stringify(f)); }


// ─── Daily Tasks ──────────────────────────────────────────────────────────────
const TASKS_KEY = "jeeprepro_tasks";
interface Task { id: string; text: string; date: "today" | "tomorrow"; done: boolean; createdAt: string; }
function loadTasks(): Task[] {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]"); } catch { return []; }
}
function saveTasks(t: Task[]) { localStorage.setItem(TASKS_KEY, JSON.stringify(t)); }

// ─── Reviews ──────────────────────────────────────────────────────────────────
interface Review { id: string; username: string; rating: number; reviewText: string; createdAt: string; }
async function dbLoadReviews(): Promise<Review[]> {
  const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, username: r.username, rating: r.rating, reviewText: r.review_text, createdAt: r.created_at }));
}
async function dbSaveReview(r: Review) {
  const { error } = await supabase.from("reviews").insert({ id: r.id, username: r.username, rating: r.rating, review_text: r.reviewText, created_at: r.createdAt });
  if (error) throw error;
}
async function dbDeleteReview(id: string) {
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) throw error;
}
async function dbSaveDriveLink(meta: StoredFile) {
  const { error } = await supabase.from("files").upsert({
    id: meta.id, name: meta.name, type: meta.type, size: 0,
    subject: meta.subject, folder: meta.folder,
    uploaded_at: meta.uploadedAt, trashed: false,
    trashed_at: null, starred: false, mime_type: "gdrive",
    external_url: meta.externalUrl,
  });
  if (error) throw error;
}

// ─── Folder structure ─────────────────────────────────────────────────────────
interface FolderDef { id: string; label: string; icon: any; color: string; children?: FolderDef[]; }
const SUBJECT_FOLDERS: FolderDef[] = [
  { id: "Physics", label: "Physics", icon: Atom, color: "text-cyan-400" },
  { id: "Chemistry", label: "Chemistry", icon: FlaskConical, color: "text-emerald-400",
    children: [
      { id: "Chemistry/Physical Chemistry",  label: "Physical Chemistry",  icon: Layers,   color: "text-emerald-300" },
      { id: "Chemistry/Organic Chemistry",   label: "Organic Chemistry",   icon: Leaf,     color: "text-green-400"   },
      { id: "Chemistry/Inorganic Chemistry", label: "Inorganic Chemistry", icon: TestTube, color: "text-teal-400"    },
    ],
  },
  { id: "Mathematics", label: "Mathematics", icon: Calculator, color: "text-violet-400" },
];

// ─── Supabase Storage + DB ────────────────────────────────────────────────────
const BUCKET = "files";

function rowToFile(r: any): StoredFile {
  return {
    id: r.id, name: r.name, type: r.type as FileType, size: r.size,
    subject: r.subject, folder: r.folder,
    uploadedAt: r.uploaded_at, trashed: r.trashed, trashedAt: r.trashed_at ?? undefined,
    starred: r.starred, mimeType: r.mime_type,
    externalUrl: r.external_url ?? undefined,
    driveFileId: r.drive_file_id ?? undefined,
    driveAccountId: r.drive_account_id ?? undefined,
  };
}

// storagePath for regular files = meta.id
// storagePath for google-drive files = "google-drive/" + meta.id
function storagePath(meta: StoredFile) {
  return meta.mimeType === "gdrive" ? `google-drive/${meta.id}` : meta.id;
}

// Save metadata only (for Drive-backed files — blob already in Drive)
async function dbSaveFileMeta(meta: StoredFile): Promise<void> {
  const { error } = await supabase.from("files").upsert({
    id: meta.id, name: meta.name, type: meta.type, size: meta.size,
    subject: meta.subject, folder: meta.folder,
    uploaded_at: meta.uploadedAt, trashed: meta.trashed,
    trashed_at: meta.trashedAt ?? null, starred: meta.starred,
    mime_type: meta.mimeType,
    external_url: meta.externalUrl ?? null,
    drive_file_id: meta.driveFileId ?? null,
    drive_account_id: meta.driveAccountId ?? null,
  });
  if (error) throw error;
}

// Legacy: upload to Supabase Storage (fallback when Drive not configured)
async function dbSaveFile(meta: StoredFile, blob: Blob) {
  const path = storagePath(meta);
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: meta.mimeType || "application/octet-stream", upsert: true,
  });
  if (uploadErr) throw uploadErr;
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData?.publicUrl ?? null;
  const { error: dbErr } = await supabase.from("files").upsert({
    id: meta.id, name: meta.name, type: meta.type, size: meta.size,
    subject: meta.subject, folder: meta.folder,
    uploaded_at: meta.uploadedAt, trashed: meta.trashed,
    trashed_at: meta.trashedAt ?? null, starred: meta.starred,
    mime_type: meta.mimeType, external_url: publicUrl,
    drive_file_id: null, drive_account_id: null,
  });
  if (dbErr) throw dbErr;
}

// Upload a Google Drive-style file to Supabase Storage under google-drive/ prefix
async function dbUploadDriveFile(meta: StoredFile, blob: Blob): Promise<string> {
  const path = `google-drive/${meta.id}`;
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: meta.mimeType || "application/octet-stream", upsert: true,
  });
  if (uploadErr) throw uploadErr;
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData?.publicUrl ?? "";
  const { error: dbErr } = await supabase.from("files").upsert({
    id: meta.id, name: meta.name, type: meta.type, size: meta.size,
    subject: meta.subject, folder: meta.folder,
    uploaded_at: meta.uploadedAt, trashed: false,
    trashed_at: null, starred: false,
    mime_type: "gdrive", external_url: publicUrl,
  });
  if (dbErr) throw dbErr;
  return publicUrl;
}

async function dbLoadAll(): Promise<StoredFile[]> {
  const { data, error } = await supabase.from("files").select("*").order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFile);
}

async function dbUpdateMeta(meta: StoredFile) {
  const { error } = await supabase.from("files").update({
    trashed: meta.trashed, trashed_at: meta.trashedAt ?? null, starred: meta.starred,
  }).eq("id", meta.id);
  if (error) throw error;
}

async function dbDeleteFile(id: string, mimeType?: string, driveFileId?: string, driveAccountId?: string, fileSize = 0, driveClientId = "") {
  // Delete from Google Drive if it's a Drive-backed file
  if (driveFileId && driveAccountId && driveClientId) {
    try {
      const mgr = getDriveManager(driveClientId);
      await mgr.deleteFile(driveAccountId, driveFileId, fileSize);
    } catch (e) { console.warn("Drive delete failed (file may be already gone):", e); }
  } else {
    // Legacy: delete from Supabase Storage
    const path = mimeType === "gdrive" ? `google-drive/${id}` : id;
    await supabase.storage.from(BUCKET).remove([path]);
  }
  await supabase.from("files").delete().eq("id", id);
}

async function dbDownload(id: string, name: string, externalUrl?: string, driveFileId?: string) {
  // Prefer stored public URL (works for Drive files made public, and Supabase Storage)
  const url = externalUrl ?? (driveFileId ? `https://drive.google.com/uc?export=download&id=${driveFileId}` : null);
  if (url) {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.target = "_blank"; a.rel = "noopener"; a.click();
    return;
  }
  // Fallback: Supabase Storage
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(id);
  if (urlData?.publicUrl) {
    const a = document.createElement("a"); a.href = urlData.publicUrl; a.download = name; a.target = "_blank"; a.click();
    return;
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(id);
  if (error || !data) throw error ?? new Error("Download failed");
  const objUrl = URL.createObjectURL(data);
  const a = document.createElement("a"); a.href = objUrl; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function detectType(mime: string): FileType {
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("word") || mime.includes("text") || mime.includes("document") || mime.includes("presentation") || mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("powerpoint")) return "doc";
  return "other";
}
function fileExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "FILE";
}
const extColors: Record<string, string> = {
  PDF: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  JPG: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  JPEG: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  PNG: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  GIF: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  MP4: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  WEBM: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  DOC:  "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  DOCX: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  PPT:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  PPTX: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  XLS:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  XLSX: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  TXT:  "bg-slate-500/20 text-slate-300 border-slate-500/30",
  ZIP:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
};
const ExtBadge = memo(function ExtBadge({ name }: { name: string }) {
  const ext = fileExt(name);
  const cls = extColors[ext] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-wider ${cls}`}>{ext}</span>;
});
const fmtSize = fmtBytes; // alias
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(2)} MB`; return `${(b / 1073741824).toFixed(2)} GB`;
}
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
const subjectColors: Record<string, string> = {
  Physics: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  Chemistry: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  Mathematics: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  MockTests: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  Books: "text-rose-400 bg-rose-400/10 border-rose-400/20",
  Other: "text-slate-400 bg-slate-400/10 border-slate-400/20",
};
function fileColor(t: FileType) {
  if (t === "pdf") return "text-rose-400"; if (t === "image") return "text-sky-400";
  if (t === "video") return "text-purple-400"; if (t === "doc") return "text-indigo-400";
  return "text-slate-400";
}
function FileIcon({ type, size = 18 }: { type: FileType; size?: number }) {
  const s = { width: size, height: size };
  if (type === "pdf") return <FileText style={s} className={fileColor(type)} />;
  if (type === "image") return <ImageIcon style={s} className={fileColor(type)} />;
  if (type === "doc") return <BookMarked style={s} className={fileColor(type)} />;
  return <File style={s} className={fileColor(type)} />;
}

// ─── Countdowns ───────────────────────────────────────────────────────────────
const JEE_ADV_DATE   = new Date("2028-05-28T09:00:00+05:30");
const JEE_MAINS_DATE = new Date("2028-01-22T09:00:00+05:30");
function useDiff(target: Date) {
  const [diff, setDiff] = useState(target.getTime() - Date.now());
  useEffect(() => { const id = setInterval(() => setDiff(target.getTime() - Date.now()), 1000); return () => clearInterval(id); }, []);
  const t = Math.max(0, diff);
  return { days: Math.floor(t / 86400000), hours: Math.floor((t % 86400000) / 3600000), mins: Math.floor((t % 3600000) / 60000), secs: Math.floor((t % 60000) / 1000) };
}
function CountdownBlock({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold text-foreground border relative overflow-hidden"
        style={{ fontFamily: "'JetBrains Mono',monospace", background: "var(--secondary)", borderColor: "var(--border)" }}>
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <span className="relative z-10">{String(value).padStart(2, "0")}</span>
      </div>
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
type Toast = { id: string; msg: string; type: "success" | "error" | "info" };
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} style={{ backdropFilter: "blur(12px)" }}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm pointer-events-auto ${t.type === "success" ? "bg-emerald-950/90 border-emerald-500/30 text-emerald-300" : t.type === "error" ? "bg-rose-950/90 border-rose-500/30 text-rose-300" : "bg-card border-border text-foreground"}`}>
          {t.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          {t.type === "error" && <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />}
          {t.type === "info" && <Clock className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
          {t.msg}
          <button onClick={() => onDismiss(t.id)} className="ml-1 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Reusable DropZone ────────────────────────────────────────────────────────
function DropZone({ onFiles, uploading }: { onFiles: (f: FileList) => void; uploading: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { e.target.files && onFiles(e.target.files); (e.target as HTMLInputElement).value = ""; }} />
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-7 cursor-pointer transition-all ${over ? "border-primary" : "border-border hover:border-primary/40"}`}
        style={{ background: over ? "rgba(99,102,241,0.06)" : undefined }}>
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">Uploading…</span>
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center mb-3"><Upload className="w-5 h-5 text-primary" /></div>
            <p className="text-sm font-medium text-foreground">{over ? "Drop to upload" : "Drag & drop files here"}</p>
            <p className="text-xs text-muted-foreground mt-1">or <span className="text-primary">browse files</span></p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── FileListTable ────────────────────────────────────────────────────────────
const FileListTable = memo(function FileListTable({ files, onDownload, onDelete, isAuthor, label }: {
  files: StoredFile[];
  onDownload: (id: string, name: string, url?: string, driveFileId?: string) => void;
  onDelete?: (id: string) => void;
  isAuthor: boolean;
  label?: string;
}) {
  if (files.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <FolderOpen className="w-10 h-10 opacity-20" />
      <p className="text-sm">{label ?? "No files here yet"}</p>
    </div>
  );
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
      {/* Mobile: swipeable rows */}
      <div className="md:hidden">
        {files.map((f) => (
          <SwipeableFileRow
            key={f.id}
            file={f}
            onDownload={() => onDownload(f.id, f.name, f.externalUrl, f.driveFileId)}
            onDelete={isAuthor && onDelete ? () => onDelete(f.id) : undefined}
            isAuthor={isAuthor}
          />
        ))}
      </div>
      {/* Desktop: table */}
      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Size</th>
            <th className="px-4 py-3 text-left font-medium">Uploaded</th>
            <th className="px-4 py-3 text-left font-medium w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="border-b last:border-b-0 hover:bg-secondary/40 transition-colors group" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <td className="px-4 py-3"><div className="flex items-center gap-3"><FileIcon type={f.type} size={15} /><span className="text-foreground truncate max-w-[200px] font-medium">{f.name}</span><ExtBadge name={f.name} /></div></td>
              <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmtBytes(f.size)}</td>
              <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(f.uploadedAt)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onDownload(f.id, f.name, f.externalUrl, f.driveFileId)} className="p-1 rounded text-muted-foreground hover:text-primary transition-colors" title="Download"><Download className="w-3.5 h-3.5" /></button>
                  {isAuthor && onDelete && <button onClick={() => onDelete(f.id)} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ─── Swipe Gesture Hook ───────────────────────────────────────────────────────
function useSwipe(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  threshold = 55
) {
  const sx = useRef(0), sy = useRef(0);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    sx.current = e.touches[0].clientX;
    sy.current = e.touches[0].clientY;
  }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - sx.current;
    const dy = e.changedTouches[0].clientY - sy.current;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > threshold) {
      if (dx < 0) onSwipeLeft(); else onSwipeRight();
    }
  }, [onSwipeLeft, onSwipeRight, threshold]);
  return { onTouchStart, onTouchEnd };
}

// ─── Upload Progress Bar ──────────────────────────────────────────────────────
const UploadProgressBar = memo(function UploadProgressBar({
  progress, fileName,
}: { progress: UploadProgress | null; fileName: string }) {
  if (!progress) return null;
  return (
    <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 rounded-2xl border shadow-2xl px-4 py-3"
      style={{ background: "var(--card)", borderColor: "var(--border)", backdropFilter: "blur(16px)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground truncate max-w-[200px]">{fileName}</span>
        <span className="text-xs text-primary font-mono font-bold">{progress.percent}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
        <div className="h-full rounded-full transition-all duration-200"
          style={{ width: `${progress.percent}%`, background: "var(--primary)" }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 font-mono">
        {fmtBytes(progress.loaded)} / {fmtBytes(progress.total)}
      </p>
    </div>
  );
});

// ─── Swipeable File Card ──────────────────────────────────────────────────────
const SwipeableFileRow = memo(function SwipeableFileRow({
  file, onDownload, onDelete, isAuthor,
}: {
  file: StoredFile;
  onDownload: () => void;
  onDelete?: () => void;
  isAuthor: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [revealed, setRevealed] = useState<"left" | "right" | null>(null);
  const startX = useRef(0);
  const THRESH = 60;

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    setOffset(Math.max(-120, Math.min(120, dx)));
  };
  const onTouchEnd = () => {
    if (offset < -THRESH) { setRevealed("left"); setOffset(-100); }
    else if (offset > THRESH && isAuthor) { setRevealed("right"); setOffset(100); }
    else { setRevealed(null); setOffset(0); }
  };
  const dismiss = () => { setRevealed(null); setOffset(0); };

  return (
    <div className="relative overflow-hidden" style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Left action: Download (revealed by swipe right) */}
      {isAuthor && (
        <div className="absolute inset-y-0 left-0 flex items-center px-4"
          style={{ background: "rgba(16,185,129,0.12)", width: 100 }}>
          <button onClick={() => { onDownload(); dismiss(); }}
            className="flex flex-col items-center gap-1 text-emerald-400">
            <Download className="w-5 h-5" />
            <span className="text-[9px] font-medium">Download</span>
          </button>
        </div>
      )}
      {/* Right action: Delete (revealed by swipe left) */}
      {isAuthor && (
        <div className="absolute inset-y-0 right-0 flex items-center justify-end px-4"
          style={{ background: "rgba(239,68,68,0.12)", width: 100 }}>
          <button onClick={() => { onDelete?.(); dismiss(); }}
            className="flex flex-col items-center gap-1 text-rose-400">
            <Trash2 className="w-5 h-5" />
            <span className="text-[9px] font-medium">Delete</span>
          </button>
        </div>
      )}
      {/* Main row */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={revealed ? dismiss : undefined}
        style={{
          transform: `translateX(${offset}px)`,
          transition: revealed !== null || offset === 0 ? "transform 0.2s ease" : "none",
          background: "var(--card)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
        <FileIcon type={file.type} size={15} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium truncate">{file.name}</p>
          <p className="text-[10px] text-muted-foreground">{fmtBytes(file.size)} · {fmtDate(file.uploadedAt)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ExtBadge name={file.name} />
          {/* Always-visible download button on mobile */}
          <button onClick={onDownload} className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── Supabase Connection Test ─────────────────────────────────────────────────
function SupabaseTest() {
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [detail, setDetail] = useState("");

  const runTest = async () => {
    setStatus("testing"); setDetail("");
    try {
      // Test 1: DB read
      const { error: dbReadErr } = await supabase.from("files").select("id").limit(1);
      if (dbReadErr) { setStatus("error"); setDetail(`DB Read Error: ${dbReadErr.message}`); return; }

      // Test 2: DB write
      const testId = "__test_row__";
      const { error: dbWriteErr } = await supabase.from("files").upsert({
        id: testId, name: "test", type: "other", size: 0,
        subject: "Other", folder: "Other",
        uploaded_at: new Date().toISOString(), trashed: false,
        starred: false, mime_type: "text/plain",
      });
      if (dbWriteErr) { setStatus("error"); setDetail(`DB Write Error: ${dbWriteErr.message}`); return; }
      await supabase.from("files").delete().eq("id", testId);

      // Test 3: Storage upload
      const testBlob = new Blob(["ping"], { type: "text/plain" });
      const { error: upErr } = await supabase.storage.from("jee-files").upload("__test__", testBlob, { upsert: true });
      if (upErr) { setStatus("error"); setDetail(`Storage Upload Error: ${upErr.message}`); return; }
      await supabase.storage.from("jee-files").remove(["__test__"]);

      setStatus("ok"); setDetail("DB Read ✓  DB Write ✓  Storage ✓  Sab ready hai!");
    } catch (e: any) {
      setStatus("error"); setDetail(e?.message ?? "Unknown error");
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "'Outfit',sans-serif" }}>Supabase Connection</h2>
      <p className="text-xs text-muted-foreground mb-4">Test karo ki cloud storage kaam kar raha hai</p>
      <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${status === "ok" ? "bg-emerald-400" : status === "error" ? "bg-rose-400" : status === "testing" ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/30"}`} />
          <span className="text-sm text-foreground flex-1">
            {status === "idle" && "Test nahi kiya gaya"}
            {status === "testing" && "Testing..."}
            {status === "ok" && "Connected!"}
            {status === "error" && "Connection failed"}
          </span>
          <button onClick={runTest} disabled={status === "testing"}
            className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {status === "testing" ? "Testing…" : "Test Connection"}
          </button>
        </div>
        {detail && (
          <p className={`text-xs px-3 py-2 rounded-lg font-mono break-all ${status === "ok" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
            {detail}
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Drive File Uploader ───────────────────────────────────────────────────────
// Uploads large files to Supabase Storage under google-drive/ prefix
function DriveFileUploader({ folder, subject, onAdded }: {
  folder: string; subject: string; onAdded: (meta: StoredFile) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    for (const raw of Array.from(fileList)) {
      setProgress(`Uploading ${raw.name}…`);
      try {
        const meta: StoredFile = {
          id: crypto.randomUUID(), name: raw.name,
          type: detectType(raw.type), size: raw.size,
          subject, folder,
          uploadedAt: new Date().toISOString(),
          trashed: false, starred: false,
          mimeType: "gdrive",
        };
        const publicUrl = await dbUploadDriveFile(meta, raw);
        onAdded({ ...meta, externalUrl: publicUrl });
      } catch (e: any) {
        setProgress(`Error: ${e?.message ?? "upload failed"}`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    setProgress(""); setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <input ref={inputRef} type="file" multiple className="hidden" id="drive-upload"
        onChange={(e) => handleFiles(e.target.files)} />
      <label htmlFor="drive-upload"
        className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer hover:border-primary/50 transition-all select-none"
        style={{ borderColor: "var(--border)", background: "rgba(66,133,244,0.04)" }}>
        {uploading ? (
          <div className="flex items-center gap-3 w-full">
            <div className="w-5 h-5 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin flex-shrink-0" />
            <span className="text-sm text-muted-foreground">{progress}</span>
          </div>
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#4285f4,#0f9d58)" }}>
              <Globe className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Upload to Drive Storage</p>
              <p className="text-xs text-muted-foreground mt-0.5">Large files stored securely in Supabase under google-drive/</p>
            </div>
          </>
        )}
      </label>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(""); setLoading(true);
    try {
      const u = username.trim();
      // Author check
      if (u.toLowerCase() === AUTHOR.username.toLowerCase() && password === AUTHOR.password) {
        const s: Session = { username: AUTHOR.username, role: "author" };
        saveSession(s); onLogin(s); return;
      }
      // Supabase user check
      const found = await dbFindUser(u);
      if (found && found.password_hash === simpleHash(password)) {
        const s: Session = { username: found.username, role: "user" };
        saveSession(s); onLogin(s); return;
      }
      setError("Invalid username or password.");
    } catch { setError("Login failed. Check your connection."); }
    finally { setLoading(false); }
  };

  const handleSignup = async () => {
    setError(""); setLoading(true);
    try {
      if (!username.trim()) { setError("Username is required."); return; }
      if (password.length < 4) { setError("Password must be at least 4 characters."); return; }
      if (password !== confirmPw) { setError("Passwords do not match."); return; }
      if (username.trim().toLowerCase() === AUTHOR.username.toLowerCase()) { setError("That username is reserved."); return; }
      const exists = await dbUsernameExists(username.trim());
      if (exists) { setError("Username already taken."); return; }
      await dbCreateUser(username.trim(), simpleHash(password));
      setTab("login");
      setUsername(username.trim());
      setPassword(""); setConfirmPw(""); setError(""); setSignupSuccess(true);
    } catch (e: any) { setError(e?.message ?? "Signup failed. Check your connection."); }
    finally { setLoading(false); }
  };

  return (
    <div className="size-full flex bg-background text-foreground" style={{ fontFamily: "'DM Sans',sans-serif" }}>
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0f1423 0%, #080b14 60%, #0a0e1a 100%)" }}>
        <div className="absolute inset-0 opacity-30"
          style={{ backgroundImage: "radial-gradient(circle at 30% 50%, var(--primary) 0%, transparent 60%)" }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center"><Zap className="w-5 h-5 text-white" /></div>
            <div>
              <div className="text-lg font-bold text-white" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Prep Pro</div>
              <div className="text-[10px] text-white/40 tracking-widest uppercase">2028 Edition</div>
            </div>
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight mb-4" style={{ fontFamily: "'Outfit',sans-serif" }}>
              Your Complete<br />JEE Preparation<br />Platform
            </h1>
            <p className="text-white/50 text-sm leading-relaxed">Store notes, mock tests, and books. Track your countdown to JEE 2028.</p>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-3 p-4 rounded-2xl border" style={{ borderColor: "rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.05)" }}>
          <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-white">Manager / Author Login</p>
            <p className="text-[10px] text-white/40 mt-0.5">Full upload & delete access for authorised manager only</p>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Logo (mobile) */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8 justify-center">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><Zap className="w-4 h-4 text-white" /></div>
            <span className="text-lg font-bold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Prep Pro</span>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "'Outfit',sans-serif" }}>
            {tab === "login" ? "Welcome back" : "Create account"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {tab === "login" ? "Sign in to your account to continue" : "Sign up to access study materials"}
          </p>

          {/* Tabs */}
          <div className="flex rounded-xl border p-1 mb-6" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
            {(["login", "signup"] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setError(""); setSignupSuccess(false); }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === t ? "bg-primary text-white shadow" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "login" ? "Log In" : "Sign Up"}
              </button>
            ))}
          </div>
          {signupSuccess && tab === "login" && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border mb-4" style={{ background: "rgba(5,150,105,0.08)", borderColor: "rgba(5,150,105,0.25)" }}>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-400">Account created! Please log in to continue.</p>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (tab === "login" ? handleLogin() : handleSignup())}
                placeholder="Enter your username"
                className="w-full px-4 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
              <div className="relative">
                <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"}
                  onKeyDown={(e) => e.key === "Enter" && (tab === "login" ? handleLogin() : handleSignup())}
                  placeholder="Enter your password"
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                <button onClick={() => setShowPw((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {tab === "signup" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm Password</label>
                <input value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} type={showPw ? "text" : "password"}
                  onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                  placeholder="Re-enter password"
                  className="w-full px-4 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
              </div>
            )}
            {error && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}</p>}
            <button onClick={tab === "login" ? handleLogin : handleSignup} disabled={loading}
              className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {loading ? "Please wait…" : tab === "login" ? "Log In" : "Create Account"}
            </button>
          </div>

          {tab === "login" && (
            <div className="mt-6 p-4 rounded-xl border" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
              <p className="text-xs text-muted-foreground text-center">
                <span className="font-medium text-foreground">Regular users:</span> Sign up above for view & download access.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  useEffect(() => { applyTheme(loadTheme(), loadAccent()); }, []);

  if (!session) return <LoginPage onLogin={setSession} />;
  return <MainApp session={session} onLogout={() => { saveSession(null); setSession(null); }} />;
}

function MainApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const isAuthor = session.role === "author";

  const [page, setPage] = useState<Page>("dashboard");
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // ── Upload destination modal ──
  type UploadDest = "closed" | "destination" | "supabase" | "drive" | "drive-form";
  const [uploadDest, setUploadDest] = useState<UploadDest>("closed");
  const [uploadDriveFolder, setUploadDriveFolder] = useState("General");
  const [uploadDriveUrl, setUploadDriveUrl] = useState("");
  const [uploadDriveName, setUploadDriveName] = useState("");
  const [newDriveFolderInput, setNewDriveFolderInput] = useState("");
  const [showNewDriveInput, setShowNewDriveInput] = useState(false);
  const [driveLinkSaving, setDriveLinkSaving] = useState(false);

  // ── Drive virtual folders ──
  const [driveFolderNames, setDriveFolderNames] = useState<string[]>(loadDriveFolderNames);
  const [openDriveFolder, setOpenDriveFolder] = useState<string | null>(null);

  // Google Drive
  const [driveClientId, setDriveClientId] = useState(loadDriveClientId);
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveClientInput, setDriveClientInput] = useState(loadDriveClientId);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const driveManagerRef = useRef(getDriveManager(loadDriveClientId()));

  // Keep DriveManager in sync with clientId
  useEffect(() => {
    driveManagerRef.current = getDriveManager(driveClientId);
  }, [driveClientId]);

  // Load Drive accounts on mount
  useEffect(() => {
    if (!driveClientId) return;
    driveManagerRef.current.loadAccounts().then(setDriveAccounts).catch(() => {});
  }, [driveClientId]);

  const connectDriveAccount = useCallback(async () => {
    if (!driveClientId) { addToast("Please enter your Google Client ID first", "error"); return; }
    setDriveConnecting(true);
    try {
      const account = await driveManagerRef.current.connectAccount();
      setDriveAccounts((p) => [...p, account]);
      addToast(`${account.email} connected!`, "success");
    } catch (e: any) { addToast(e?.message ?? "Drive connect failed", "error"); }
    finally { setDriveConnecting(false); }
  }, [driveClientId]);

  const disconnectDriveAccount = useCallback(async (id: string) => {
    await driveManagerRef.current.disconnectAccount(id);
    setDriveAccounts((p) => p.filter((a) => a.id !== id));
    addToast("Drive account disconnected", "info");
  }, []);

  const refreshDriveQuota = useCallback(async (id: string) => {
    try {
      const updated = await driveManagerRef.current.refreshQuota(id);
      if (updated) setDriveAccounts((p) => p.map((a) => a.id === id ? updated : a));
    } catch (e: any) { addToast("Quota refresh failed", "error"); }
  }, []);

  // Subjects nav
  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [openSubFolder, setOpenSubFolder] = useState<string | null>(null);

  // Tasks
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [newTask, setNewTask] = useState("");
  const [taskDate, setTaskDate] = useState<"today" | "tomorrow">("today");

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  useEffect(() => { dbLoadReviews().then(setReviews).catch(() => {}); }, []);

  const submitReview = async () => {
    if (!reviewText.trim()) return;
    setReviewLoading(true);
    try {
      const r: Review = { id: crypto.randomUUID(), username: session.username, rating: reviewRating, reviewText: reviewText.trim(), createdAt: new Date().toISOString() };
      await dbSaveReview(r);
      setReviews((p) => [r, ...p]);
      setReviewText(""); setReviewRating(5);
      addToast("Review submit ho gaya!", "success");
    } catch { addToast("Review save nahi hua", "error"); }
    finally { setReviewLoading(false); }
  };
  const deleteReview = async (id: string) => {
    await dbDeleteReview(id);
    setReviews((p) => p.filter((r) => r.id !== id));
    addToast("Review deleted", "info");
  };

  const storageFileInput = useRef<HTMLInputElement>(null);
  const advCountdown  = useDiff(JEE_ADV_DATE);
  const mainsCountdown = useDiff(JEE_MAINS_DATE);

  // Theme
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadTheme);
  const [accentId, setAccentId] = useState<string>(loadAccent);
  useEffect(() => { applyTheme(themeMode, accentId); localStorage.setItem(THEME_KEY, themeMode); localStorage.setItem(ACCENT_KEY, accentId); }, [themeMode, accentId]);

  // Profile
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [editingName, setEditingName] = useState(false);
  const [editingBatch, setEditingBatch] = useState(false);
  const [nameInput, setNameInput] = useState(profile.name);
  const [batchInput, setBatchInput] = useState(profile.batch);
  const nameRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const commitName = () => { const t = nameInput.trim(); if (t) { const u = { ...profile, name: t }; setProfile(u); saveProfile(u); } else setNameInput(profile.name); setEditingName(false); };
  const commitBatch = () => { const t = batchInput.trim(); if (t) { const u = { ...profile, batch: t }; setProfile(u); saveProfile(u); } else setBatchInput(profile.batch); setEditingBatch(false); };
  useEffect(() => { if (editingName) nameRef.current?.focus(); }, [editingName]);
  useEffect(() => { if (editingBatch) batchRef.current?.focus(); }, [editingBatch]);

  const addToast = useCallback((msg: string, type: Toast["type"] = "info") => {
    const id = crypto.randomUUID();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  const reloadFiles = useCallback(() => {
    setRefreshing(true);
    dbLoadAll().then((f) => { setFiles(f); setRefreshing(false); }).catch(() => { addToast("Failed to load files", "error"); setRefreshing(false); });
  }, []);

  useEffect(() => { reloadFiles(); }, []);

  // Supabase Realtime: live sync across all devices and browsers
  useEffect(() => {
    const channel = supabase.channel("files-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "files" }, reloadFiles)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reloadFiles]);

  const activeFiles = useMemo(() => files.filter((f) => !f.trashed), [files]);
  const trashedFiles = useMemo(() => files.filter((f) => f.trashed), [files]);
  const totalBytes = useMemo(() => activeFiles.reduce((s, f) => s + f.size, 0), [activeFiles]);
  const pdfBytes = useMemo(() => activeFiles.filter((f) => f.type === "pdf").reduce((s, f) => s + f.size, 0), [activeFiles]);
  const imgBytes = useMemo(() => activeFiles.filter((f) => f.type === "image").reduce((s, f) => s + f.size, 0), [activeFiles]);
  const docBytes = useMemo(() => activeFiles.filter((f) => f.type === "doc").reduce((s, f) => s + f.size, 0), [activeFiles]);
  const otherBytes = useMemo(() => totalBytes - pdfBytes - imgBytes - docBytes, [totalBytes, pdfBytes, imgBytes, docBytes]);
  const usedPct = useMemo(() => Math.min((totalBytes / (10 * 1073741824)) * 100, 100), [totalBytes]);

  const sqLower = useMemo(() => searchQuery.toLowerCase(), [searchQuery]);
  const storageFiltered = useMemo(() => activeFiles.filter((f) => {
    const q = f.name.toLowerCase().includes(sqLower);
    if (activeFilter === "Starred") return q && f.starred;
    if (activeFilter === "PDFs") return q && f.type === "pdf";
    if (activeFilter === "Images") return q && f.type === "image";
    if (activeFilter === "Documents") return q && f.type === "doc";
    return q;
  }), [activeFiles, sqLower, activeFilter]);

  const doUpload = useCallback(async (rawFiles: File[], folder: string) => {
    if (!isAuthor) { addToast("Only the manager can upload files", "error"); return; }
    setUploading(true);
    let count = 0;
    const subject = folder.split("/")[0];
    const mgr = driveManagerRef.current;
    const useDrive = driveClientId && mgr.getAll().length > 0;

    for (const raw of rawFiles) {
      const mime = raw.type || "";
      setUploadingFileName(raw.name);
      setUploadProgress(null);

      const meta: StoredFile = {
        id: crypto.randomUUID(), name: raw.name, type: detectType(mime),
        size: raw.size, subject, folder,
        uploadedAt: new Date().toISOString(), trashed: false, starred: false, mimeType: mime,
      };

      try {
        if (useDrive) {
          // Upload to Google Drive
          const result = await mgr.upload(raw, (p) => setUploadProgress(p));
          const driveMeta: StoredFile = {
            ...meta,
            externalUrl: result.downloadUrl,
            driveFileId: result.driveFileId,
            driveAccountId: result.accountId,
          };
          await dbSaveFileMeta(driveMeta);
          setFiles((p) => [...p, driveMeta]);
        } else {
          // Fallback: Supabase Storage
          await dbSaveFile(meta, raw);
          setFiles((p) => [...p, meta]);
        }
        count++;
      } catch (e: any) {
        const msg = e?.message ?? e?.error_description ?? JSON.stringify(e) ?? "unknown";
        addToast(`Upload failed: ${msg}`, "error");
        console.error("Upload error:", e);
      }
    }

    setUploadProgress(null);
    setUploadingFileName("");
    setUploading(false);
    if (count > 0) {
      addToast(`${count} file${count > 1 ? "s" : ""} uploaded${useDrive ? " to Google Drive" : ""}`, "success");
      dbLoadAll().then(setFiles).catch(() => {});
    }
  }, [isAuthor, driveClientId, addToast]);

  const handleStorageUpload = (rawList: FileList | null) => {
    if (!rawList || rawList.length === 0) return;
    if (!isAuthor) { addToast("Only the manager can upload files", "error"); return; }
    setPendingFiles(Array.from(rawList));
    setUploadDest("destination");
  };
  const closeUploadModal = () => {
    setUploadDest("closed"); setPendingFiles([]);
    setUploadDriveUrl(""); setUploadDriveName("");
    setNewDriveFolderInput(""); setShowNewDriveInput(false);
  };
  const confirmSubjectUpload = (folder: string) => { closeUploadModal(); doUpload(pendingFiles, folder); };
  const addDriveFolderName = () => {
    const name = newDriveFolderInput.trim();
    if (!name) return;
    const updated = [...new Set([...driveFolderNames, name])];
    setDriveFolderNames(updated); saveDriveFolderNames(updated);
    setNewDriveFolderInput(""); setShowNewDriveInput(false);
  };
  const saveDriveLink = async () => {
    if (!uploadDriveUrl.trim()) return;
    setDriveLinkSaving(true);
    try {
      const meta: StoredFile = {
        id: crypto.randomUUID(),
        name: uploadDriveName.trim() || uploadDriveUrl.trim(),
        type: "other", size: 0,
        subject: "GDrive", folder: uploadDriveFolder,
        uploadedAt: new Date().toISOString(),
        trashed: false, starred: false,
        mimeType: "gdrive",
        externalUrl: uploadDriveUrl.trim(),
      };
      await dbSaveDriveLink(meta);
      setFiles((p) => [meta, ...p]);
      closeUploadModal();
      addToast(`Link saved in "${uploadDriveFolder}"!`, "success");
    } catch { addToast("Save nahi hua", "error"); }
    finally { setDriveLinkSaving(false); }
  };

  const handleTrash = async (id: string) => {
    if (!isAuthor) return;
    const f = files.find((x) => x.id === id); if (!f) return;
    const u = { ...f, trashed: true, trashedAt: new Date().toISOString() };
    await dbUpdateMeta(u); setFiles((p) => p.map((x) => x.id === id ? u : x));
    addToast(`"${f.name}" moved to trash`, "info"); setActiveMenu(null);
  };
  const handlePermDelete = useCallback(async (id: string) => {
    if (!isAuthor) return;
    const f = files.find((x) => x.id === id); if (!f) return;
    await dbDeleteFile(id, f.mimeType, f.driveFileId, f.driveAccountId, f.size, driveClientId);
    setFiles((p) => p.filter((x) => x.id !== id));
    addToast(`"${f.name}" permanently deleted`, "error");
  }, [isAuthor, files, driveClientId, addToast]);
  const handleRestore = async (id: string) => {
    if (!isAuthor) return;
    const f = files.find((x) => x.id === id); if (!f) return;
    const u = { ...f, trashed: false, trashedAt: undefined };
    await dbUpdateMeta(u);
    setFiles((p) => p.map((x) => x.id === id ? u : x));
    addToast(`"${f.name}" restored`, "success");
  };
  const handleRestoreAll = async () => {
    if (!isAuthor) return;
    for (const f of trashedFiles) {
      const u = { ...f, trashed: false, trashedAt: undefined };
      await dbUpdateMeta(u);
    }
    setFiles((p) => p.map((x) => x.trashed ? { ...x, trashed: false, trashedAt: undefined } : x));
    addToast("All files restored", "success");
  };
  const handleEmptyTrash = useCallback(async () => {
    if (!isAuthor) return;
    for (const f of trashedFiles) {
      await dbDeleteFile(f.id, f.mimeType, f.driveFileId, f.driveAccountId, f.size, driveClientId);
    }
    setFiles((p) => p.filter((x) => !x.trashed));
    addToast("Trash emptied permanently", "error");
  }, [isAuthor, trashedFiles, driveClientId, addToast]);
  const handleStar = async (id: string) => {
    if (!isAuthor) return;
    const f = files.find((x) => x.id === id); if (!f) return;
    const u = { ...f, starred: !f.starred }; await dbUpdateMeta(u);
    setFiles((p) => p.map((x) => x.id === id ? u : x));
  };
  const handleDownload = useCallback((id: string, name: string, externalUrl?: string, driveFileId?: string) => {
    dbDownload(id, name, externalUrl, driveFileId).catch(() => addToast("Download failed", "error"));
    addToast(`Downloading "${name}"`, "success"); setActiveMenu(null);
  }, [addToast]);

  const filesInFolder = useCallback((folder: string) => activeFiles.filter((f) => f.folder === folder), [activeFiles]);
  const bookFiles = useMemo(() => activeFiles.filter((f) => f.folder === "Books"), [activeFiles]);
  const mockTestFiles = useMemo(() => activeFiles.filter((f) => f.folder === "MockTests"), [activeFiles]);

  // Tasks
  const addTask = () => {
    if (!newTask.trim()) return;
    const t: Task = { id: crypto.randomUUID(), text: newTask.trim(), date: taskDate, done: false, createdAt: new Date().toISOString() };
    const updated = [...tasks, t]; setTasks(updated); saveTasks(updated); setNewTask("");
  };
  const toggleTask = (id: string) => {
    const updated = tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated); saveTasks(updated);
  };
  const deleteTask = (id: string) => { const updated = tasks.filter((t) => t.id !== id); setTasks(updated); saveTasks(updated); };
  const todayTasks = tasks.filter((t) => t.date === "today");
  const tomorrowTasks = tasks.filter((t) => t.date === "tomorrow");

  // Google Drive links — backed by Supabase (files table, mimeType=gdrive)
  const gdriveLinks = useMemo(() => files.filter((f) => f.mimeType === "gdrive" && !f.trashed), [files]);
  // All unique drive folder names (from saved + from existing files)
  const allDriveFolderNames = useMemo(() => {
    const fromFiles = gdriveLinks.map((f) => f.folder).filter(Boolean);
    return [...new Set([...driveFolderNames, ...fromFiles])];
  }, [driveFolderNames, gdriveLinks]);
  // Mobile full nav drawer
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" as Page },
    { icon: BookOpen, label: "Subjects", id: "subjects" as Page },
    { icon: ClipboardList, label: "Mock Tests", id: "tests" as Page },
    { icon: BookCopy, label: "Books", id: "books" as Page },
    { icon: Globe, label: "Google Drive", id: "gdrive" as Page },
    { icon: Cloud, label: "Cloud Storage", id: "storage" as Page },
    { icon: ListTodo, label: "My Tasks", id: "tasks" as Page },
    { icon: MessageSquare, label: "Reviews", id: "reviews" as Page },
    ...(isAuthor ? [{ icon: Trash2, label: "Trash", id: "trash" as Page, badge: trashedFiles.length || undefined }] : []),
    { icon: Settings, label: "Settings", id: "settings" as Page },
  ] as { icon: any; label: string; id: Page; badge?: number }[];
  // Bottom nav items for mobile — last item opens full menu drawer
  const mobileNavItems = [
    { icon: LayoutDashboard, label: "Home", id: "dashboard" as Page },
    { icon: BookOpen, label: "Subjects", id: "subjects" as Page },
    { icon: BookCopy, label: "Books", id: "books" as Page },
    { icon: Globe, label: "G.Drive", id: "gdrive" as Page },
  ];

  return (
    <div className="size-full flex bg-background text-foreground overflow-hidden" style={{ fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Sidebar (desktop only) ── */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col border-r h-full" style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}>
        <div className="px-5 py-5 border-b" style={{ borderColor: "var(--sidebar-border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><Zap className="w-4 h-4 text-white" /></div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Prep Pro</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 tracking-widest uppercase">2028 Edition</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 group ${page === item.id ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`}>
              <item.icon className={`w-4 h-4 flex-shrink-0 ${page === item.id ? "text-primary" : "group-hover:text-foreground"}`} />
              {item.label}
              {item.badge ? (
                <span className="ml-auto text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-full px-1.5 py-0.5 font-mono">{item.badge}</span>
              ) : page === item.id ? <ChevronRight className="w-3 h-3 ml-auto text-primary/60" /> : null}
            </button>
          ))}
        </nav>

        {/* Storage bar */}
        <div className="mx-3 mb-3 p-3 rounded-xl border" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-foreground">Storage</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground font-mono">{fmtBytes(totalBytes)}</span>
              <button onClick={reloadFiles} title="Refresh files" className="text-muted-foreground hover:text-primary transition-colors">
                <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${usedPct}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">{activeFiles.length} files · 10 GB</p>
        </div>

        {/* User profile */}
        <div className="px-3 py-3 border-t" style={{ borderColor: "var(--sidebar-border)" }}>
          <div className="rounded-lg p-2.5" style={{ background: "var(--secondary)" }}>
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-primary text-[10px] font-bold flex-shrink-0 ${isAuthor ? "p-0.5" : "bg-primary/20"}`}
                style={isAuthor ? { background: "linear-gradient(135deg,#6366f1,#7c3aed)", boxShadow: "0 0 8px rgba(99,102,241,0.5)" } : undefined}>
                {isAuthor ? <ShieldCheck className="w-3.5 h-3.5 text-white" /> : (profile.name ? profile.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() : session.username[0].toUpperCase())}
              </div>
              <div className="flex-1 min-w-0">
                {isAuthor ? (
                  <>
                    <p className="text-xs font-semibold text-foreground truncate leading-none mb-1">{session.username}</p>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold tracking-widest uppercase"
                      style={{ background: "linear-gradient(90deg,rgba(99,102,241,0.25),rgba(124,58,237,0.25))", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc" }}>
                      <ShieldCheck className="w-2.5 h-2.5" /> Administrator
                    </span>
                  </>
                ) : editingName ? (
                  <div className="flex items-center gap-1">
                    <input ref={nameRef} value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                      onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameInput(profile.name); setEditingName(false); } }}
                      className="flex-1 text-xs bg-transparent border-b border-primary outline-none text-foreground min-w-0" placeholder="Your name" />
                    <button onMouseDown={(e) => { e.preventDefault(); commitName(); }} className="text-primary"><Check className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <button onClick={() => { setNameInput(profile.name); setEditingName(true); }} className="group flex items-center gap-1 w-full text-left">
                    <span className="text-xs font-medium text-foreground truncate">{profile.name || <span className="italic text-muted-foreground">{session.username}</span>}</span>
                    <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                )}
                {!isAuthor && (editingBatch ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <input ref={batchRef} value={batchInput} onChange={(e) => setBatchInput(e.target.value)}
                      onBlur={commitBatch} onKeyDown={(e) => { if (e.key === "Enter") commitBatch(); if (e.key === "Escape") { setBatchInput(profile.batch); setEditingBatch(false); } }}
                      className="flex-1 text-[10px] bg-transparent border-b border-primary/60 outline-none text-muted-foreground min-w-0" />
                    <button onMouseDown={(e) => { e.preventDefault(); commitBatch(); }} className="text-primary"><Check className="w-2.5 h-2.5" /></button>
                  </div>
                ) : (
                  <button onClick={() => { setBatchInput(profile.batch); setEditingBatch(true); }} className="group flex items-center gap-1 w-full text-left mt-0.5">
                    <span className="text-[10px] text-muted-foreground truncate">{profile.batch}</span>
                    <Pencil className="w-2 h-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
            <button onClick={onLogout} className="w-full flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground hover:text-destructive transition-colors py-1">
              <LogOut className="w-3 h-3" /> Log out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center gap-3 px-4 py-3 border-b" style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}>
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0"><Zap className="w-3.5 h-3.5 text-white" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Prep Pro</p>
          <p className="text-[10px] text-muted-foreground capitalize">{page}</p>
        </div>
        <button onClick={reloadFiles} className="text-muted-foreground hover:text-primary p-1.5">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
        <button onClick={onLogout} className="text-muted-foreground hover:text-destructive p-1.5"><LogOut className="w-4 h-4" /></button>
      </div>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden pt-0 md:pt-0">
        {/* Mobile top spacer */}
        <div className="md:hidden h-[52px] flex-shrink-0" />

        {/* ══ DASHBOARD ══ */}
        {page === "dashboard" && (
          <div className="flex-1 overflow-y-auto pb-24 md:pb-6 px-4 md:px-8 py-6 space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>
                {isAuthor ? `Welcome, ${AUTHOR.username} 👋` : profile.name ? `Hey, ${profile.name.split(" ")[0]} 👋` : "Dashboard"}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{profile.batch} · Track your preparation</p>
            </div>

            {/* Two countdowns */}
            <div className="grid grid-cols-1 gap-3 md:gap-4">
              {/* JEE Advanced */}
              <section className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <Target className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Advanced 2028</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">28 May 2028</span>
                  </div>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <CountdownBlock value={advCountdown.days} label="Days" />
                    <span className="text-2xl font-bold text-primary/40 mb-4" style={{ fontFamily: "'JetBrains Mono',monospace" }}>:</span>
                    <CountdownBlock value={advCountdown.hours} label="Hrs" />
                    <span className="text-2xl font-bold text-primary/40 mb-4" style={{ fontFamily: "'JetBrains Mono',monospace" }}>:</span>
                    <CountdownBlock value={advCountdown.mins} label="Min" />
                    <span className="text-2xl font-bold text-primary/40 mb-4" style={{ fontFamily: "'JetBrains Mono',monospace" }}>:</span>
                    <CountdownBlock value={advCountdown.secs} label="Sec" />
                  </div>
                </div>
              </section>

              {/* JEE Mains */}
              <section className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <CalendarCheck className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-semibold" style={{ fontFamily: "'Outfit',sans-serif" }}>JEE Mains 2028</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">22 Jan 2028 · Session 1</span>
                  </div>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    {[{ v: mainsCountdown.days, l: "Days" }, { v: mainsCountdown.hours, l: "Hrs" }, { v: mainsCountdown.mins, l: "Min" }, { v: mainsCountdown.secs, l: "Sec" }].map((x, i, arr) => (
                      <div key={x.l} className="flex items-center gap-3">
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold text-foreground border relative overflow-hidden"
                            style={{ fontFamily: "'JetBrains Mono',monospace", background: "var(--secondary)", borderColor: "rgba(251,191,36,0.2)" }}>
                            <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent" />
                            <span className="relative z-10">{String(x.v).padStart(2, "0")}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{x.l}</span>
                        </div>
                        {i < arr.length - 1 && <span className="text-2xl font-bold text-amber-400/40 mb-4" style={{ fontFamily: "'JetBrains Mono',monospace" }}>:</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Cloud, label: "Files", value: activeFiles.length.toString(), sub: fmtBytes(totalBytes), color: "text-indigo-400" },
                { icon: BookCopy, label: "Books", value: bookFiles.length.toString(), sub: "Google Drive", color: "text-rose-400" },
                { icon: ClipboardList, label: "Mock Tests", value: mockTestFiles.length.toString(), sub: "Uploaded", color: "text-amber-400" },
                { icon: ListTodo, label: "Tasks Today", value: todayTasks.filter((t) => !t.done).length.toString(), sub: `${todayTasks.filter((t) => t.done).length} done`, color: "text-emerald-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className={`${s.color} mb-2`}><s.icon className="w-4 h-4" /></div>
                  <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Recent files */}
            {activeFiles.length > 0 && (
              <section className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <span className="text-sm font-semibold" style={{ fontFamily: "'Outfit',sans-serif" }}>Recent Files</span>
                  <button onClick={() => setPage("storage")} className="text-xs text-primary hover:underline">View all</button>
                </div>
                {[...activeFiles].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 5).map((f) => (
                  <div key={f.id} className="px-5 py-3 flex items-center gap-3 border-b last:border-b-0 hover:bg-secondary/40 transition-colors" style={{ borderColor: "var(--border)" }}>
                    <FileIcon type={f.type} size={15} />
                    <span className="flex-1 text-sm text-foreground truncate">{f.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${subjectColors[f.subject] ?? subjectColors.Other}`}>{f.subject}</span>
                    <button onClick={() => handleDownload(f.id, f.name, f.externalUrl, f.driveFileId)} className="p-1 text-muted-foreground hover:text-foreground"><Download className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {/* ══ SUBJECTS ══ */}
        {page === "subjects" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              {(openSubject || openSubFolder) && (
                <button onClick={() => { if (openSubFolder) setOpenSubFolder(null); else setOpenSubject(null); }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>
                  {openSubFolder ? openSubFolder.split("/").pop() : openSubject ?? "Subjects"}
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {openSubFolder ? `${filesInFolder(openSubFolder).length} files` : openSubject === "Chemistry" ? "3 sub-folders" : openSubject ? `${filesInFolder(openSubject).length} files` : "3 subjects"}
                </p>
              </div>
              {isAuthor && (openSubFolder || (openSubject && openSubject !== "Chemistry")) && (
                <>
                  <input type="file" multiple className="hidden" id="subj-upload"
                    onChange={(e) => { handleStorageUpload(e.target.files); (e.target as HTMLInputElement).value = ""; }} />
                  <label htmlFor="subj-upload" className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </label>
                </>
              )}
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6">
              {!openSubject && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                  {SUBJECT_FOLDERS.map((sub) => {
                    const count = activeFiles.filter((f) => f.subject === sub.id || f.folder.startsWith(sub.id)).length;
                    return (
                      <button key={sub.id} onClick={() => setOpenSubject(sub.id)}
                        className="rounded-2xl border p-6 flex flex-col gap-4 text-left hover:border-primary/40 transition-all group" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                          <sub.icon className={`w-6 h-6 ${sub.color}`} />
                        </div>
                        <div>
                          <p className="text-base font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>{sub.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{sub.children ? `${sub.children.length} sub-folders` : `${count} file${count !== 1 ? "s" : ""}`}</p>
                        </div>
                        <div className="mt-auto flex items-center gap-1 text-primary text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Open <ChevronRight className="w-3 h-3" /></div>
                      </button>
                    );
                  })}
                </div>
              )}
              {openSubject === "Chemistry" && !openSubFolder && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                  {SUBJECT_FOLDERS.find((s) => s.id === "Chemistry")!.children!.map((child) => {
                    const count = filesInFolder(child.id).length;
                    return (
                      <button key={child.id} onClick={() => setOpenSubFolder(child.id)}
                        className="rounded-2xl border p-6 flex flex-col gap-4 text-left hover:border-primary/40 transition-all group" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                          <child.icon className={`w-6 h-6 ${child.color}`} />
                        </div>
                        <div>
                          <p className="text-base font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>{child.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{count} file{count !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="mt-auto flex items-center gap-1 text-primary text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Open <ChevronRight className="w-3 h-3" /></div>
                      </button>
                    );
                  })}
                </div>
              )}
              {(openSubFolder || (openSubject && openSubject !== "Chemistry")) && (() => {
                const folder = openSubFolder ?? openSubject!;
                return (
                  <div className="space-y-4">
                    {isAuthor && <DropZone onFiles={(fl) => handleStorageUpload(fl)} uploading={uploading} />}
                    <FileListTable files={filesInFolder(folder)} onDownload={handleDownload} onDelete={handleTrash} isAuthor={isAuthor} label="No files in this folder yet" />
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* ══ MOCK TESTS ══ */}
        {page === "tests" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>Mock Tests</h1>
                <p className="text-xs text-muted-foreground mt-1">{mockTestFiles.length} tests uploaded</p>
              </div>
              {isAuthor && (
                <>
                  <input type="file" multiple className="hidden" id="mock-upload"
                    onChange={(e) => { handleStorageUpload(e.target.files); (e.target as HTMLInputElement).value = ""; }} />
                  <label htmlFor="mock-upload" className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> Upload Test
                  </label>
                </>
              )}
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-4">
              {!isAuthor && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
                  <Eye className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">You can <strong className="text-foreground">view and download</strong> tests. Only the manager can upload.</p>
                </div>
              )}
              {isAuthor && <DropZone onFiles={(fl) => handleStorageUpload(fl)} uploading={uploading} />}
              <FileListTable files={mockTestFiles} onDownload={handleDownload} onDelete={handleTrash} isAuthor={isAuthor} label="No mock tests uploaded yet" />
            </div>
          </>
        )}

        {/* ══ BOOKS (Google Drive style) ══ */}
        {page === "books" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>Books</h1>
                <p className="text-xs text-muted-foreground mt-1">{bookFiles.length} books · Google Drive style storage</p>
              </div>
              {isAuthor && (
                <>
                  <input type="file" multiple className="hidden" id="books-upload"
                    onChange={(e) => { handleStorageUpload(e.target.files); (e.target as HTMLInputElement).value = ""; }} />
                  <label htmlFor="books-upload" className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" /> Add Book
                  </label>
                </>
              )}
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-5">
              {/* Drive-style header bar */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#4285f4,#0f9d58)" }}>
                  <BookCopy className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">JEE Books Library</p>
                  <p className="text-xs text-muted-foreground">All study books stored securely in one place</p>
                </div>
                {!isAuthor && (
                  <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground border rounded-lg px-3 py-1.5" style={{ borderColor: "var(--border)" }}>
                    <Eye className="w-3.5 h-3.5" /> View & Download only
                  </div>
                )}
              </div>

              {isAuthor && <DropZone onFiles={(fl) => handleStorageUpload(fl)} uploading={uploading} />}

              {bookFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                  <BookCopy className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium">No books uploaded yet</p>
                  {isAuthor && <p className="text-xs opacity-60">Upload JEE books to get started</p>}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {bookFiles.map((file) => (
                    <div key={file.id} className="group relative rounded-xl border p-4 flex flex-col gap-3 hover:border-primary/30 transition-all" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      {isAuthor && (
                        <button onClick={() => handleTrash(file.id)} className="absolute top-2 right-2 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className="flex items-start gap-3 pr-7">
                        <div className="w-12 h-14 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(99,102,241,0.05))", border: "1px solid rgba(99,102,241,0.2)" }}>
                          <FileIcon type={file.type} size={22} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <ExtBadge name={file.name} />
                          <p className="text-sm font-medium text-foreground truncate leading-snug mt-1">{file.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{fmtBytes(file.size)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(file.uploadedAt)}</p>
                        </div>
                      </div>
                      <button onClick={() => handleDownload(file.id, file.name, file.externalUrl, file.driveFileId)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors" style={{ borderColor: "var(--border)" }}>
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ REVIEWS ══ */}
        {page === "reviews" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>Reviews</h1>
                <p className="text-xs text-muted-foreground mt-1">{reviews.length} review{reviews.length !== 1 ? "s" : ""} · apna experience share karo</p>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-6 max-w-2xl">
              {/* Write review box */}
              <div className="rounded-2xl border p-5 space-y-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>Apna Review Likho</p>
                {/* Star rating */}
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map((s) => (
                    <button key={s} onMouseEnter={() => setReviewHover(s)} onMouseLeave={() => setReviewHover(0)} onClick={() => setReviewRating(s)}>
                      <Star className={`w-7 h-7 transition-colors ${(reviewHover || reviewRating) >= s ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"}`} />
                    </button>
                  ))}
                  <span className="ml-2 text-sm text-muted-foreground">{["","Bahut bura","Bura","Theek hai","Acha","Bahut acha!"][reviewHover || reviewRating]}</span>
                </div>
                <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)}
                  placeholder="App ke baare mein apna experience likho... kya acha laga, kya improve ho sakta hai?"
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none transition-all"
                  style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                <button onClick={submitReview} disabled={reviewLoading || !reviewText.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {reviewLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                  {reviewLoading ? "Submitting…" : "Submit Review"}
                </button>
              </div>

              {/* Reviews list */}
              {reviews.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                  <MessageSquare className="w-10 h-10 opacity-20" />
                  <p className="text-sm">Abhi koi review nahi — pehle review likhne wale bano!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reviews.map((r) => (
                    <div key={r.id} className="rounded-xl border p-4 space-y-2 group" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0" style={{ background: "var(--primary)", color: "white" }}>
                            {r.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground leading-none">{r.username}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(r.createdAt)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5">
                            {[1,2,3,4,5].map((s) => (
                              <Star key={s} className={`w-3.5 h-3.5 ${r.rating >= s ? "text-amber-400 fill-amber-400" : "text-muted-foreground/20"}`} />
                            ))}
                          </div>
                          {(isAuthor || r.username === session.username) && (
                            <button onClick={() => deleteReview(r.id)} className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-foreground/80 leading-relaxed pl-10">{r.reviewText}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ CLOUD STORAGE ══ */}
        {page === "storage" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>Cloud Storage</h1>
                <p className="text-xs text-muted-foreground mt-1">{activeFiles.length} files · {fmtBytes(totalBytes)}</p>
              </div>
              <div className="relative w-52 flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search files…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
              </div>
              {isAuthor && (
                <>
                  <input ref={storageFileInput} type="file" multiple className="hidden" onChange={(e) => handleStorageUpload(e.target.files)} />
                  <button onClick={() => storageFileInput.current?.click()} disabled={uploading}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
                    {uploading ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Upload</>}
                  </button>
                </>
              )}
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-5">
              <section className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2"><HardDrive className="w-4 h-4 text-primary" /><span className="text-sm font-semibold" style={{ fontFamily: "'Outfit',sans-serif" }}>Storage Overview</span></div>
                  <span className="text-xs text-muted-foreground font-mono">{fmtBytes(totalBytes)} / 10 GB</span>
                </div>
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden flex mb-3">
                  {totalBytes > 0 && [{ v: pdfBytes, c: "bg-rose-500" }, { v: imgBytes, c: "bg-sky-500" }, { v: docBytes, c: "bg-indigo-500" }, { v: otherBytes, c: "bg-slate-500" }].filter((x) => x.v > 0).map((x, i) => (
                    <div key={i} className={`h-full ${x.c}`} style={{ width: `${(x.v / totalBytes) * 100}%` }} />
                  ))}
                </div>
                <div className="flex gap-5 flex-wrap text-xs text-muted-foreground">
                  {[{ label: "PDFs", v: pdfBytes, c: "bg-rose-500" }, { label: "Images", v: imgBytes, c: "bg-sky-500" }, { label: "Docs", v: docBytes, c: "bg-indigo-500" }, { label: "Other", v: otherBytes, c: "bg-slate-500" }].map((x) => (
                    <div key={x.label} className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-full ${x.c}`} /><span>{x.label}</span><span className="font-mono text-foreground">{fmtBytes(x.v)}</span></div>
                  ))}
                </div>
              </section>

              {isAuthor && (
                <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleStorageUpload(e.dataTransfer.files); }}
                  onClick={() => storageFileInput.current?.click()}
                  className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-7 cursor-pointer border-border hover:border-primary/40 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center mb-3"><Upload className="w-5 h-5 text-primary" /></div>
                  <p className="text-sm font-medium text-foreground">Drag & drop files here</p>
                  <p className="text-xs text-muted-foreground mt-1">or <span className="text-primary">browse files</span></p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {["All", "PDFs", "Images", "Documents", "Starred"].map((f) => (
                    <button key={f} onClick={() => setActiveFilter(f)}
                      className={`px-3 py-1 text-xs rounded-full border transition-all ${activeFilter === f ? "bg-primary text-white border-primary" : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"}`}>{f}</button>
                  ))}
                </div>
                <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => setView("grid")} className={`p-1.5 transition-colors ${view === "grid" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setView("list")} className={`p-1.5 transition-colors ${view === "list" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}><List className="w-3.5 h-3.5" /></button>
                </div>
              </div>

              {storageFiltered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <FolderOpen className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium">{activeFiles.length === 0 ? "No files yet" : "No files match"}</p>
                </div>
              )}

              {storageFiltered.length > 0 && view === "grid" && (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {storageFiltered.map((file) => (
                    <div key={file.id} className="group relative rounded-xl border p-4 flex flex-col gap-3 hover:border-primary/30 transition-all" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      {isAuthor && (
                        <>
                          <button onClick={() => handleStar(file.id)} className={`absolute top-3 right-8 p-0.5 rounded transition-all ${file.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                            <Star className={`w-3.5 h-3.5 ${file.starred ? "text-amber-400 fill-amber-400" : "text-muted-foreground hover:text-amber-400"}`} />
                          </button>
                          <div className="absolute top-3 right-2">
                            <button onClick={() => setActiveMenu(activeMenu === file.id ? null : file.id)} className="p-0.5 rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {activeMenu === file.id && (
                              <div className="absolute right-0 top-6 z-20 w-40 rounded-lg border shadow-xl py-1 text-sm" style={{ background: "var(--popover)", borderColor: "var(--border)" }}>
                                <button onClick={() => handleDownload(file.id, file.name, file.externalUrl, file.driveFileId)} className="w-full flex items-center gap-2.5 px-3 py-2 text-foreground hover:bg-secondary transition-colors"><Download className="w-3.5 h-3.5" /> Download</button>
                                <button onClick={() => handleStar(file.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-foreground hover:bg-secondary transition-colors"><Star className="w-3.5 h-3.5" /> {file.starred ? "Unstar" : "Star"}</button>
                                <div className="border-t my-1" style={{ borderColor: "var(--border)" }} />
                                <button onClick={() => handleTrash(file.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-destructive hover:bg-destructive/10 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Move to Trash</button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}><FileIcon type={file.type} size={18} /></div>
                        <ExtBadge name={file.name} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">{fmtBytes(file.size)}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${subjectColors[file.subject] ?? subjectColors.Other}`}>{file.subject}</span>
                        <button onClick={() => handleDownload(file.id, file.name, file.externalUrl, file.driveFileId)} className="text-muted-foreground hover:text-primary transition-colors"><Download className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {storageFiltered.length > 0 && view === "list" && (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-xs text-muted-foreground" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
                      <th className="px-4 py-3 text-left font-medium">Name</th><th className="px-4 py-3 text-left font-medium">Subject</th>
                      <th className="px-4 py-3 text-left font-medium">Size</th><th className="px-4 py-3 text-left font-medium">Uploaded</th>
                      <th className="px-4 py-3 text-left font-medium w-24">Actions</th>
                    </tr></thead>
                    <tbody>
                      {storageFiltered.map((file) => (
                        <tr key={file.id} className="border-b last:border-b-0 hover:bg-secondary/40 transition-colors group" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                          <td className="px-4 py-3"><div className="flex items-center gap-3"><FileIcon type={file.type} size={15} /><span className="text-foreground font-medium truncate max-w-[180px]">{file.name}</span>{file.starred && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}</div></td>
                          <td className="px-4 py-3"><span className={`text-[10px] px-2 py-0.5 rounded-full border ${subjectColors[file.subject] ?? subjectColors.Other}`}>{file.subject}</span></td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmtBytes(file.size)}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(file.uploadedAt)}</td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleDownload(file.id, file.name, file.externalUrl, file.driveFileId)} className="p-1 rounded text-muted-foreground hover:text-primary"><Download className="w-3.5 h-3.5" /></button>
                            {isAuthor && <><button onClick={() => handleStar(file.id)} className="p-1 rounded text-muted-foreground hover:text-amber-400"><Star className={`w-3.5 h-3.5 ${file.starred ? "fill-amber-400 text-amber-400" : ""}`} /></button>
                            <button onClick={() => handleTrash(file.id)} className="p-1 rounded text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></>}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ TASKS ══ */}
        {page === "tasks" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>My Tasks</h1>
                <p className="text-xs text-muted-foreground mt-1">{tasks.filter((t) => !t.done).length} pending · {tasks.filter((t) => t.done).length} completed</p>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-6 max-w-2xl">
              {/* Add task */}
              <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>Add New Task</p>
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                  placeholder="e.g. Revise Thermodynamics chapter…"
                  className="w-full px-4 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                <div className="flex items-center gap-3">
                  <div className="flex rounded-xl border overflow-hidden flex-1" style={{ borderColor: "var(--border)" }}>
                    {(["today", "tomorrow"] as const).map((d) => (
                      <button key={d} onClick={() => setTaskDate(d)}
                        className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-all ${taskDate === d ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                        {d === "today" ? <CalendarDays className="w-3.5 h-3.5" /> : <CalendarCheck className="w-3.5 h-3.5" />}
                        {d === "today" ? "Today" : "Tomorrow"}
                      </button>
                    ))}
                  </div>
                  <button onClick={addTask} className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>

              {/* Today's tasks */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>Today</h2>
                  <span className="text-xs text-muted-foreground">({todayTasks.length})</span>
                </div>
                {todayTasks.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground border border-dashed rounded-xl" style={{ borderColor: "var(--border)" }}>
                    <p className="text-sm">No tasks for today</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border group transition-all" style={{ background: "var(--card)", borderColor: task.done ? "transparent" : "var(--border)", opacity: task.done ? 0.7 : 1 }}>
                        <button onClick={() => toggleTask(task.id)} className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${task.done ? "bg-primary border-primary" : "border-muted-foreground hover:border-primary"}`}>
                          {task.done && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <span className={`flex-1 text-sm transition-all ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.text}</span>
                        {task.done && <span className="text-[10px] text-emerald-400 font-medium">Done</span>}
                        <button onClick={() => deleteTask(task.id)} className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Tomorrow's tasks */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarCheck className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>Tomorrow</h2>
                  <span className="text-xs text-muted-foreground">({tomorrowTasks.length})</span>
                </div>
                {tomorrowTasks.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground border border-dashed rounded-xl" style={{ borderColor: "var(--border)" }}>
                    <p className="text-sm">No tasks for tomorrow</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tomorrowTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border group transition-all" style={{ background: "var(--card)", borderColor: task.done ? "transparent" : "var(--border)", opacity: task.done ? 0.7 : 1 }}>
                        <button onClick={() => toggleTask(task.id)} className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${task.done ? "bg-primary border-primary" : "border-muted-foreground hover:border-primary"}`}>
                          {task.done && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <span className={`flex-1 text-sm transition-all ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.text}</span>
                        {task.done && <span className="text-[10px] text-emerald-400 font-medium">Done</span>}
                        <button onClick={() => deleteTask(task.id)} className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {/* ══ GOOGLE DRIVE ══ */}
        {page === "gdrive" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              {openDriveFolder && (
                <button onClick={() => setOpenDriveFolder(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>
                  {openDriveFolder ? openDriveFolder : "Google Drive"}
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {openDriveFolder
                    ? `${gdriveLinks.filter(f => f.folder === openDriveFolder).length} links`
                    : `${allDriveFolderNames.length} folder${allDriveFolderNames.length !== 1 ? "s" : ""} · ${gdriveLinks.length} total links`}
                </p>
              </div>
              {isAuthor && !openDriveFolder && (
                <button onClick={() => { setPendingFiles([]); setUploadDest("drive"); }}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Link
                </button>
              )}
            </header>

            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-5 space-y-4">
              {/* Folder list view */}
              {!openDriveFolder && (
                <>
                  {allDriveFolderNames.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                      <Globe className="w-12 h-12 opacity-20" />
                      <p className="text-sm font-medium">Koi Drive folder nahi</p>
                      {isAuthor && <p className="text-xs opacity-60">Upload ke waqt Drive folder banao</p>}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {allDriveFolderNames.map((folderName) => {
                        const count = gdriveLinks.filter((f) => f.folder === folderName).length;
                        return (
                          <button key={folderName} onClick={() => setOpenDriveFolder(folderName)}
                            className="group flex items-center gap-4 p-4 rounded-2xl border hover:border-sky-400/40 hover:bg-sky-400/5 text-left transition-all"
                            style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: "linear-gradient(135deg,rgba(66,133,244,0.15),rgba(15,157,88,0.1))", border: "1px solid rgba(66,133,244,0.2)" }}>
                              <Globe className="w-6 h-6 text-sky-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground">{folderName}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{count} link{count !== 1 ? "s" : ""}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          </button>
                        );
                      })}
                      {/* Create new folder button (author only) */}
                      {isAuthor && (
                        <button onClick={() => { setPendingFiles([]); setUploadDest("drive"); }}
                          className="flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed hover:border-primary/40 hover:bg-primary/5 text-left transition-all"
                          style={{ borderColor: "var(--border)" }}>
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/10">
                            <Plus className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">New Folder</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Naya Drive folder banao</p>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Open folder — show links inside */}
              {openDriveFolder && (() => {
                const folderLinks = gdriveLinks.filter((f) => f.folder === openDriveFolder);
                return (
                  <div className="space-y-4">
                    {/* Author: quick add link */}
                    {isAuthor && (
                      <button onClick={() => { setUploadDriveFolder(openDriveFolder); setPendingFiles([]); setUploadDest("drive-form"); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
                        style={{ borderColor: "var(--border)" }}>
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Plus className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Link add karo</p>
                          <p className="text-xs text-muted-foreground">Google Drive ya koi bhi URL</p>
                        </div>
                      </button>
                    )}

                    {folderLinks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                        <Globe className="w-10 h-10 opacity-20" />
                        <p className="text-sm">Is folder mein koi link nahi</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {folderLinks.map((link) => (
                          <div key={link.id} className="group relative rounded-xl border p-4 flex flex-col gap-3 hover:border-sky-400/30 transition-all"
                            style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                            {isAuthor && (
                              <button onClick={() => handleTrash(link.id)}
                                className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <div className="flex items-start gap-3 pr-7">
                              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ background: "linear-gradient(135deg,#4285f4 0%,#0f9d58 100%)" }}>
                                <Globe className="w-5 h-5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{link.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-1 truncate">{link.externalUrl}</p>
                                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{fmtDate(link.uploadedAt)}</p>
                              </div>
                            </div>
                            <a href={link.externalUrl} target="_blank" rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors"
                              style={{ borderColor: "var(--border)" }}>
                              <ExternalLink className="w-3.5 h-3.5" /> Browser mein kholein
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* ══ TRASH ══ */}
        {page === "trash" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex items-center gap-3 md:gap-4 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-foreground leading-none" style={{ fontFamily: "'Outfit',sans-serif" }}>Trash / Recycle Bin</h1>
                <p className="text-xs text-muted-foreground mt-1">{trashedFiles.length} file{trashedFiles.length !== 1 ? "s" : ""} · restore or permanently delete</p>
              </div>
              {isAuthor && trashedFiles.length > 0 && (
                <div className="flex items-center gap-2">
                  <button onClick={handleRestoreAll} className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium rounded-lg hover:bg-emerald-500/20 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Restore All
                  </button>
                  <button onClick={handleEmptyTrash} className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 text-sm font-medium rounded-lg hover:bg-destructive/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Empty Trash
                  </button>
                </div>
              )}
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-4">
              {/* Info banner */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)" }}>
                <RefreshCw className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-emerald-400/90">Files yahan recycle bin mein hain — <strong>Restore</strong> karo wapas lane ke liye, ya <strong>Delete Forever</strong> se permanently hatao.</p>
              </div>
              {trashedFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Trash2 className="w-12 h-12 opacity-20" />
                  <p className="text-sm font-medium">Recycle bin is empty</p>
                  <p className="text-xs opacity-50">Deleted files will appear here</p>
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground" style={{ background: "var(--secondary)", borderColor: "var(--border)" }}>
                        <th className="px-4 py-3 text-left font-medium">Name</th>
                        <th className="px-4 py-3 text-left font-medium">Folder</th>
                        <th className="px-4 py-3 text-left font-medium">Size</th>
                        <th className="px-4 py-3 text-left font-medium">Deleted</th>
                        <th className="px-4 py-3 text-left font-medium w-44">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trashedFiles.map((file) => (
                        <tr key={file.id} className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors group" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="opacity-50"><FileIcon type={file.type} size={15} /></div>
                              <span className="text-foreground/70 truncate max-w-[180px]">{file.name}</span>
                              <ExtBadge name={file.name} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${subjectColors[file.subject] ?? subjectColors.Other}`}>{file.subject}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmtBytes(file.size)}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{file.trashedAt ? fmtDate(file.trashedAt) : "—"}</td>
                          <td className="px-4 py-3">
                            {isAuthor && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => handleRestore(file.id)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/10 transition-colors">
                                  <RefreshCw className="w-3 h-3" /> Restore
                                </button>
                                <button onClick={() => handlePermDelete(file.id)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-destructive border border-destructive/20 hover:bg-destructive/10 transition-colors">
                                  <X className="w-3 h-3" /> Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ SETTINGS ══ */}
        {page === "settings" && (
          <>
            <header className="px-4 md:px-8 py-3 md:py-4 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
              <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>Settings</h1>
              <p className="text-xs text-muted-foreground mt-1">Personalise your experience</p>
            </header>
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0 px-4 md:px-8 py-6 space-y-8 max-w-2xl">
              <SupabaseTest />

              {/* ── Google Drive Accounts ── */}
              {isAuthor && (
                <section>
                  <h2 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "'Outfit',sans-serif" }}>Google Drive Storage</h2>
                  <p className="text-xs text-muted-foreground mb-4">Connect multiple Google Drive accounts for unlimited file storage. Files are auto-routed to the drive with most free space.</p>

                  {/* Client ID input */}
                  <div className="rounded-xl border p-4 space-y-3 mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <p className="text-xs font-medium text-foreground">Google OAuth Client ID</p>
                    <div className="flex gap-2">
                      <input value={driveClientInput} onChange={(e) => setDriveClientInput(e.target.value)}
                        placeholder="1234567890-abc.apps.googleusercontent.com"
                        className="flex-1 px-3 py-2 rounded-lg border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                        style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                      <button onClick={() => {
                        saveDriveClientId(driveClientInput);
                        setDriveClientId(driveClientInput);
                        addToast("Client ID saved", "success");
                      }} className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors flex-shrink-0">Save</button>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Create at <span className="text-primary">console.cloud.google.com</span> → APIs → Credentials → OAuth 2.0 Client ID (Web application). Add your site's URL to Authorized JavaScript origins.
                    </p>
                  </div>

                  {/* Connected drives */}
                  <div className="space-y-2 mb-3">
                    {driveAccounts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 rounded-xl border border-dashed text-muted-foreground" style={{ borderColor: "var(--border)" }}>
                        <Globe className="w-8 h-8 opacity-20 mb-2" />
                        <p className="text-xs">No Drive accounts connected yet</p>
                      </div>
                    ) : (
                      driveAccounts.map((acc) => {
                        const pct = acc.storageTotal > 0 ? Math.min((acc.storageUsed / acc.storageTotal) * 100, 100) : 0;
                        return (
                          <div key={acc.id} className="rounded-xl border p-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                                style={{ background: "linear-gradient(135deg,#4285f4,#0f9d58)" }}>
                                {acc.email[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{acc.email}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{fmtBytes(acc.storageUsed)} / {fmtBytes(acc.storageTotal)} used</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => refreshDriveQuota(acc.id)} className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors" title="Refresh quota">
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => disconnectDriveAccount(acc.id)} className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors" title="Disconnect">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                              <div className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, background: pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e" }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">{fmtBytes(acc.storageFree)} free · {pct.toFixed(1)}% used</p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Drive storage summary */}
                  {driveAccounts.length > 0 && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-lg mb-3" style={{ background: "var(--secondary)" }}>
                      <Globe className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Total: <span className="text-foreground font-mono font-medium">{fmtBytes(driveAccounts.reduce((s, a) => s + a.storageFree, 0))}</span> free across {driveAccounts.length} account{driveAccounts.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  )}

                  <button onClick={connectDriveAccount} disabled={driveConnecting || !driveClientId}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {driveConnecting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
                    {driveConnecting ? "Connecting…" : "Connect Google Drive Account"}
                  </button>
                </section>
              )}
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "'Outfit',sans-serif" }}>Theme</h2>
                <p className="text-xs text-muted-foreground mb-4">Choose how the app looks</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "dark" as ThemeMode, label: "Dark", sub: "Easy on eyes at night", bg: "#080b14", sidebar: "#0b0f1e", card: "#0f1423", bar: "#1e2640" },
                    { id: "light" as ThemeMode, label: "Light", sub: "Clean daytime look", bg: "#f6f7fb", sidebar: "#ffffff", card: "#ffffff", bar: "#eef0f8" },
                  ].map((t) => (
                    <button key={t.id} onClick={() => setThemeMode(t.id)}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${themeMode === t.id ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-primary/40"}`}>
                      <div className="h-24 p-3" style={{ background: t.bg }}>
                        <div className="flex gap-2 h-full">
                          <div className="w-10 rounded-lg" style={{ background: t.sidebar }}>
                            <div className="mt-2 mx-1 space-y-1.5">{[32, 24, 32, 24].map((w, i) => <div key={i} className="h-1.5 rounded-full" style={{ width: `${w}px`, background: i === 0 ? "var(--primary)" : t.bar }} />)}</div>
                          </div>
                          <div className="flex-1 space-y-1.5 pt-1">
                            <div className="h-2 w-16 rounded-full" style={{ background: t.bar }} />
                            <div className="grid grid-cols-2 gap-1">{[0,1,2,3].map((i) => <div key={i} className="h-7 rounded-lg" style={{ background: t.card }} />)}</div>
                          </div>
                        </div>
                      </div>
                      <div className="px-3 py-2.5 border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                        <div className="flex items-center justify-between">
                          <div><p className="text-sm font-medium text-foreground">{t.label}</p><p className="text-[10px] text-muted-foreground">{t.sub}</p></div>
                          {themeMode === t.id && <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"><Check className="w-3 h-3 text-white" /></div>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1" style={{ fontFamily: "'Outfit',sans-serif" }}>Accent Colour</h2>
                <p className="text-xs text-muted-foreground mb-4">Changes buttons and highlights everywhere</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {ACCENT_COLORS.map((a) => (
                    <button key={a.id} onClick={() => setAccentId(a.id)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl border-2 transition-all ${accentId === a.id ? "border-primary" : "border-border hover:border-primary/30"}`} style={{ background: "var(--card)" }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: a.primary }}>
                        {accentId === a.id && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <div className="text-left"><p className="text-xs font-medium text-foreground">{a.label}</p><p className="text-[10px] text-muted-foreground font-mono">{a.primary}</p></div>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-3" style={{ fontFamily: "'Outfit',sans-serif" }}>Preview</h2>
                <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-3">
                    <button className="px-4 py-1.5 rounded-lg text-sm font-medium text-white" style={{ background: "var(--primary)" }}>Primary</button>
                    <button className="px-4 py-1.5 rounded-lg text-sm border text-foreground" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>Secondary</button>
                    <div className="ml-auto w-4 h-4 rounded-full" style={{ background: "var(--primary)" }} />
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                    <div className="h-full w-3/5 rounded-full" style={{ background: "var(--primary)" }} />
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {/* ── Upload Destination Modal ── */}
      {uploadDest !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0">
          <div className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="text-base font-semibold text-foreground" style={{ fontFamily: "'Outfit',sans-serif" }}>
                  {uploadDest === "destination" && "Kahan store karein?"}
                  {uploadDest === "supabase" && "Supabase folder chunein"}
                  {uploadDest === "drive" && "Drive folder chunein"}
                  {uploadDest === "drive-form" && `Link add karein — "${uploadDriveFolder}"`}
                </h2>
                {pendingFiles.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">{pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""} selected</p>
                )}
              </div>
              <button onClick={closeUploadModal} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5">
              {/* Step 1: Choose destination */}
              {uploadDest === "destination" && (
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setUploadDest("supabase")}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 hover:border-primary/60 hover:bg-primary/5 transition-all group" style={{ borderColor: "var(--border)" }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.2),rgba(99,102,241,0.05))", border: "1px solid rgba(99,102,241,0.3)" }}>
                      <Cloud className="w-6 h-6 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Supabase</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Direct file upload</p>
                    </div>
                  </button>
                  <button onClick={() => setUploadDest("drive")}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 hover:border-sky-500/40 hover:bg-sky-500/5 transition-all group" style={{ borderColor: "var(--border)" }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,rgba(66,133,244,0.15),rgba(15,157,88,0.1))", border: "1px solid rgba(66,133,244,0.3)" }}>
                      <Globe className="w-6 h-6 text-sky-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Google Drive</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Paste external link</p>
                    </div>
                  </button>
                </div>
              )}

              {/* Step 2a: Supabase folder picker */}
              {uploadDest === "supabase" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: "Physics", color: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20" },
                      { name: "Chemistry", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
                      { name: "Mathematics", color: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/20" },
                      { name: "MockTests", color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
                      { name: "Books", color: "text-rose-400", bg: "bg-rose-400/10", border: "border-rose-400/20" },
                      { name: "Other", color: "text-slate-400", bg: "bg-slate-400/10", border: "border-slate-400/20" },
                    ].map(({ name, color, bg, border }) => (
                      <button key={name} onClick={() => confirmSubjectUpload(name)}
                        className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-left hover:border-primary/40 hover:bg-primary/5 transition-all ${border}`}
                        style={{ background: "var(--secondary)" }}>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color.replace("text-", "bg-")}`} />
                        <span className={`text-sm font-medium ${color}`}>{name}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setUploadDest("destination")} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2">← Wapas jao</button>
                </div>
              )}

              {/* Step 2b: Drive folder picker */}
              {uploadDest === "drive" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {allDriveFolderNames.map((name) => {
                      const count = gdriveLinks.filter((f) => f.folder === name).length;
                      return (
                        <button key={name} onClick={() => { setUploadDriveFolder(name); setUploadDest("drive-form"); }}
                          className="flex flex-col items-start gap-1 px-4 py-3 rounded-xl border-2 hover:border-sky-400/40 hover:bg-sky-400/5 transition-all text-left"
                          style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
                          <div className="flex items-center gap-2 w-full">
                            <Globe className="w-4 h-4 text-sky-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-foreground truncate">{name}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">{count} link{count !== 1 ? "s" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* New drive folder */}
                  {showNewDriveInput ? (
                    <div className="flex gap-2">
                      <input value={newDriveFolderInput} onChange={(e) => setNewDriveFolderInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addDriveFolderName()}
                        placeholder="Folder ka naam likhein…"
                        autoFocus
                        className="flex-1 px-3 py-2 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                      <button onClick={addDriveFolderName} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">Add</button>
                      <button onClick={() => setShowNewDriveInput(false)} className="px-3 py-2 rounded-xl border text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ borderColor: "var(--border)" }}>×</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewDriveInput(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed text-sm text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
                      style={{ borderColor: "var(--border)" }}>
                      <Plus className="w-4 h-4" /> Naya Drive Folder banao
                    </button>
                  )}
                  <button onClick={() => setUploadDest("destination")} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2">← Wapas jao</button>
                </div>
              )}

              {/* Step 3: Drive link + name form */}
              {uploadDest === "drive-form" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--secondary)" }}>
                    <Globe className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">Drive Folder:</span>
                    <span className="text-xs font-semibold text-foreground">{uploadDriveFolder}</span>
                  </div>
                  <input value={uploadDriveName} onChange={(e) => setUploadDriveName(e.target.value)}
                    placeholder="Book/file ka naam (e.g. HC Verma Part 1)"
                    className="w-full px-4 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                    style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                  <input value={uploadDriveUrl} onChange={(e) => setUploadDriveUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveDriveLink()}
                    placeholder="https://drive.google.com/file/d/... ya koi bhi link"
                    className="w-full px-4 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                    style={{ background: "var(--secondary)", borderColor: "var(--border)" }} />
                  <div className="flex gap-2">
                    <button onClick={saveDriveLink} disabled={driveLinkSaving || !uploadDriveUrl.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {driveLinkSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                      {driveLinkSaving ? "Saving…" : "Save Link"}
                    </button>
                    <button onClick={() => setUploadDest("drive")} className="px-4 py-2.5 rounded-xl border text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ borderColor: "var(--border)" }}>← Back</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeMenu && <div className="fixed inset-0 z-10" onClick={() => setActiveMenu(null)} />}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
      <UploadProgressBar progress={uploadProgress} fileName={uploadingFileName} />

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t flex items-center"
        style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}>
        {mobileNavItems.map((item) => (
          <button key={item.id} onClick={() => { setPage(item.id); setShowMobileMenu(false); }}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors relative ${page === item.id && !showMobileMenu ? "text-primary" : "text-muted-foreground"}`}>
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
            {page === item.id && !showMobileMenu && <div className="absolute top-0 inset-x-4 h-0.5 bg-primary rounded-full" />}
          </button>
        ))}
        {/* More button */}
        <button onClick={() => setShowMobileMenu((v) => !v)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition-colors relative ${showMobileMenu ? "text-primary" : "text-muted-foreground"}`}>
          <Menu className="w-5 h-5" />
          <span className="font-medium">More</span>
          {showMobileMenu && <div className="absolute top-0 inset-x-4 h-0.5 bg-primary rounded-full" />}
        </button>
      </nav>

      {/* ── Mobile More drawer ── */}
      {showMobileMenu && (
        <div className="md:hidden fixed inset-0 z-30 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileMenu(false)} />
          <div className="relative rounded-t-2xl border-t shadow-2xl pb-20"
            style={{ background: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}>
            <div className="px-4 pt-4 pb-2">
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-4" />
              <p className="text-xs text-muted-foreground font-medium tracking-widest uppercase mb-3">Navigation</p>
              <div className="grid grid-cols-3 gap-2">
                {navItems.map((item) => (
                  <button key={item.id} onClick={() => { setPage(item.id); setShowMobileMenu(false); }}
                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${page === item.id ? "bg-primary/15 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                    <div className="relative">
                      <item.icon className="w-5 h-5" />
                      {item.id === "trash" && trashedFiles.length > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-rose-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{trashedFiles.length}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-medium text-center leading-none">{item.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { onLogout(); setShowMobileMenu(false); }}
                className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm text-destructive border-destructive/20 hover:bg-destructive/10 transition-colors">
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom spacer */}
      <div className="md:hidden h-16 flex-shrink-0 pointer-events-none" />
    </div>
  );
}
