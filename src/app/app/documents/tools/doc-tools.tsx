"use client";

import {
  Bold,
  Braces,
  Download,
  ExternalLink,
  FileImage,
  FilePlus,
  FileText,
  Files,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Plus,
  Scissors,
  SeparatorHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { PLACEHOLDER_GROUPS, textBlocks, type DocBlock, type Run } from "@/lib/doc-text";
import { cn } from "@/lib/utils";
import {
  convertDocumentAction,
  createDocumentAction,
  deleteTemplateAction,
  draftTemplateAction,
  extractPagesAction,
  imagesToPdfAction,
  mergePdfsAction,
  saveTemplateAction,
  type ToolResult,
} from "./actions";

type Template = { id: string; name: string; body: string; sourceDocumentId: string | null; sourceName: string | null; fields: string[] };
type FileItem = { id: string; name: string; mimeType: string };
type Option = { id: string; name: string };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";
const IMAGES = new Set(["image/png", "image/jpeg"]);
const fileHref = (id: string, download = false) => `/app/documents/${id}/file${download ? "?download" : ""}`;

export function DocTools({ templates, files, clients, orders, ai }: { templates: Template[]; files: FileItem[]; clients: Option[]; orders: { id: string; label: string }[]; ai: boolean }) {
  const { t } = useI18n();
  return (
    <Tabs defaultValue="templates" className="gap-4">
      <TabsList>
        <TabsTrigger value="templates">{t("docs.tab.templates")}</TabsTrigger>
        <TabsTrigger value="create">{t("docs.tab.create")}</TabsTrigger>
        <TabsTrigger value="convert">{t("docs.tab.convert")}</TabsTrigger>
      </TabsList>
      <TabsContent value="templates">
        <TemplatesTab templates={templates} ai={ai} />
      </TabsContent>
      <TabsContent value="create">
        <CreateTab templates={templates} clients={clients} orders={orders} />
      </TabsContent>
      <TabsContent value="convert">
        <ConvertTab files={files} ai={ai} />
      </TabsContent>
    </Tabs>
  );
}

/** A result that names a new file, with links to open and download it. */
function useResult() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<ToolResult>, then?: (r: ToolResult) => void) =>
    start(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(t(result.error ?? "common.error"));
        return;
      }
      if (result.id && result.name) {
        const id = result.id;
        toast.success(t("docs.done", { name: result.name }), { action: { label: t("docs.openFile"), onClick: () => window.open(fileHref(id), "_blank", "noopener") } });
      }
      then?.(result);
      router.refresh();
    });
  return { pending, run };
}

// --- Templates ---------------------------------------------------------------------------------

function TemplatesTab({ templates, ai }: { templates: Template[]; ai: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<string | "new">(templates[0]?.id ?? "new");
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = chosen === "new" ? null : (templates.find((tpl) => tpl.id === chosen) ?? null);

  const uploadWord = async (file: File) => {
    if (!/\.docx$/i.test(file.name)) return void toast.error(t("docs.error.TYPE"));
    const form = new FormData();
    form.append("file", file);
    form.append("category", t("docs.templates"));
    setUploading(true);
    try {
      const res = await fetch("/app/documents/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; ids?: string[]; error?: string };
      const id = body.ok ? body.ids?.[0] : undefined;
      if (!id) return void toast.error(t(`documents.${body.error ?? "TYPE"}`));
      const result = await saveTemplateAction(null, { name: file.name.replace(/\.docx$/i, ""), sourceDocumentId: id });
      if (!result.ok || !result.id) return void toast.error(t(result.error ?? "common.error"));
      toast.success(t("common.saved"));
      setChosen(result.id);
      router.refresh();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        <Button type="button" variant={chosen === "new" ? "secondary" : "outline"} className="justify-start" onClick={() => setChosen("new")}>
          <Plus className="size-4" /> {t("docs.newTemplate")}
        </Button>
        <Button type="button" variant="outline" className="justify-start" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {t("docs.uploadWord")}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadWord(file);
          }}
        />
        <div className="mt-2 grid gap-1">
          {templates.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t("docs.noTemplates")}</p>}
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setChosen(tpl.id)}
              aria-pressed={chosen === tpl.id}
              className={cn("grid gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-accent", chosen === tpl.id && "border-primary bg-accent")}
            >
              <span className="flex items-center gap-2 font-medium">
                {tpl.sourceDocumentId ? <FileText className="size-4 shrink-0 text-blue-600" /> : <FilePlus className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{tpl.name}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {tpl.sourceDocumentId ? t("docs.word") : t("docs.text")} · {t("docs.fields", { count: String(tpl.fields.length) })}
              </span>
            </button>
          ))}
        </div>
      </div>
      {current?.sourceDocumentId ? (
        <WordTemplate key={current.id} template={current} onGone={() => setChosen("new")} />
      ) : (
        <TextTemplate key={current?.id ?? "new"} template={current} ai={ai} onSaved={(id) => setChosen(id)} onGone={() => setChosen("new")} />
      )}
    </div>
  );
}

const TOOLS = [
  { key: "h1", icon: Heading1, line: "# " },
  { key: "h2", icon: Heading2, line: "## " },
  { key: "bullets", icon: List, line: "- " },
  { key: "numbers", icon: ListOrdered, line: "1. " },
  { key: "bold", icon: Bold, wrap: "**" },
  { key: "italic", icon: Italic, wrap: "*" },
  { key: "table", icon: Table2, text: "\n| A | B |\n| --- | --- |\n|  |  |\n" },
  { key: "pageBreak", icon: SeparatorHorizontal, text: "\n---\n" },
] as const;

function TextTemplate({ template, ai, onSaved, onGone }: { template: Template | null; ai: boolean; onSaved: (id: string) => void; onGone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [removing, setRemoving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const { pending, run } = useResult();
  const blocks = useMemo(() => textBlocks(body), [body]);

  /** Puts text in at the cursor: at the start of the line, around the selection, or as it is. */
  const insert = (tool: { line?: string; wrap?: string; text?: string }) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    let next: string;
    let cursor: number;
    if (tool.line) {
      const start = value.lastIndexOf("\n", a - 1) + 1;
      next = value.slice(0, start) + tool.line + value.slice(start);
      cursor = b + tool.line.length;
    } else if (tool.wrap) {
      next = value.slice(0, a) + tool.wrap + value.slice(a, b) + tool.wrap + value.slice(b);
      cursor = b + tool.wrap.length * (a === b ? 1 : 2);
    } else {
      next = value.slice(0, a) + (tool.text ?? "") + value.slice(b);
      cursor = a + (tool.text ?? "").length;
    }
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const save = () =>
    run(
      () => saveTemplateAction(template?.id ?? null, { name, body }),
      (r) => {
        toast.success(t("common.saved"));
        if (r.id) onSaved(r.id);
      },
    );

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Card className="min-w-0">
        <CardContent className="grid gap-3 pt-6">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-48 flex-1 gap-1.5">
              <span className="text-sm font-medium">{t("docs.name")}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
            {ai && (
              <Button type="button" variant="outline" onClick={() => setAsking(true)}>
                <Sparkles className="size-4" /> {t("docs.aiDraft")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1" role="toolbar" aria-label={t("docs.body")}>
            {TOOLS.map((tool) => (
              <Button key={tool.key} type="button" variant="ghost" size="icon" className="size-8" aria-label={t(`docs.tool.${tool.key}`)} title={t(`docs.tool.${tool.key}`)} onClick={() => insert(tool)}>
                <tool.icon className="size-4" />
              </Button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="ml-auto">
                  <Braces className="size-4" /> {t("docs.placeholder")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {Object.entries(PLACEHOLDER_GROUPS).map(([group, keys], i) => (
                  <div key={group}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{t(`docs.group.${group}`)}</DropdownMenuLabel>
                    {keys.map((key) => (
                      <DropdownMenuItem key={key} onSelect={() => insert({ text: `{{${key}}}` })}>
                        {t(`docs.key.${key}`)}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea ref={area} rows={20} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-80 font-mono text-sm" aria-label={t("docs.body")} maxLength={100_000} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending || !name.trim() || !body.trim()} onClick={save}>
              {t("common.save")}
            </Button>
            {template && (
              <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
                <Trash2 className="size-4" /> {t("common.delete")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="min-w-0">
        <span className="mb-2 block text-sm font-medium">{t("docs.preview")}</span>
        <DocPreview blocks={blocks} />
      </div>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("docs.aiDraft")}</DialogTitle>
            <DialogDescription className="sr-only">{t("docs.aiDraft")}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("docs.aiPrompt")}</span>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} autoFocus />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={pending || prompt.trim().length < 3}
              onClick={() =>
                run(
                  () => draftTemplateAction(prompt),
                  (r) => {
                    if (!r.draft) return;
                    if (!name.trim()) setName(r.draft.name);
                    setBody(r.draft.body);
                    setAsking(false);
                  },
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {t("docs.aiGo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("docs.deleteAsk")}
        text={template?.name ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          setRemoving(false);
          if (template) run(() => deleteTemplateAction(template.id), onGone);
        }}
      />
    </div>
  );
}

function WordTemplate({ template, onGone }: { template: Template; onGone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(template.name);
  const [removing, setRemoving] = useState(false);
  const { pending, run } = useResult();
  return (
    <Card className="min-w-0 self-start">
      <CardContent className="grid gap-4 pt-6">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">{t("docs.name")}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-blue-600" />
          {template.sourceDocumentId && (
            <a href={fileHref(template.sourceDocumentId, true)} className="truncate font-medium hover:underline">
              {template.sourceName ?? t("docs.word")}
            </a>
          )}
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("docs.placeholder")}</span>
          <div className="flex flex-wrap gap-1.5">
            {template.fields.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
            {template.fields.map((f) => (
              <Badge key={f} variant="secondary" className="font-mono">{`{{${f}}}`}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || !name.trim()} onClick={() => run(() => saveTemplateAction(template.id, { name, sourceDocumentId: template.sourceDocumentId }), () => toast.success(t("common.saved")))}>
            {t("common.save")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
            <Trash2 className="size-4" /> {t("common.delete")}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("docs.deleteAsk")}
        text={template.name}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          setRemoving(false);
          run(() => deleteTemplateAction(template.id), onGone);
        }}
      />
    </Card>
  );
}

/** Placeholders stand out in the preview, so a template shows what will be filled in. */
function Words({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} className={cn(run.bold && "font-bold", run.italic && "italic", run.underline && "underline")}>
          {run.text.split(/(\{\{\s*[a-zA-Z][\w.]*\s*\}\})/g).map((part, j) =>
            j % 2 ? (
              <mark key={j} className="rounded bg-blue-100 px-1 font-mono text-[0.85em] text-blue-800">
                {part}
              </mark>
            ) : (
              <span key={j} className="whitespace-pre-wrap">
                {part}
              </span>
            ),
          )}
        </span>
      ))}
    </>
  );
}

export function DocPreview({ blocks }: { blocks: DocBlock[] }) {
  return (
    <div className="max-h-[75vh] min-h-80 overflow-y-auto rounded-lg border bg-white px-8 py-10 text-[13px] leading-relaxed text-slate-900 shadow-sm">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const Tag = b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4";
          return (
            <Tag key={i} className={cn("mb-2 mt-4 font-bold first:mt-0", b.level === 1 ? "text-xl" : b.level === 2 ? "text-base" : "text-sm")}>
              <Words runs={b.runs} />
            </Tag>
          );
        }
        if (b.type === "paragraph") {
          return (
            <p key={i} className={cn("mb-2 min-h-4", b.align === "center" && "text-center", b.align === "right" && "text-right", b.align === "justify" && "text-justify")}>
              <Words runs={b.runs} />
            </p>
          );
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={cn("mb-2 ml-6 grid gap-0.5", b.ordered ? "list-decimal" : "list-disc")}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Words runs={item} />
                </li>
              ))}
            </Tag>
          );
        }
        if (b.type === "table") {
          return (
            <table key={i} className="mb-3 w-full border-collapse text-[12px]">
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r} className={cn(r === 0 && b.rows.length > 1 && "bg-slate-100 font-bold")}>
                    {row.map((cell, c) => (
                      <td key={c} className="border border-slate-300 px-2 py-1 align-top">
                        <Words runs={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (b.type === "pageBreak") return <hr key={i} className="my-6 border-dashed border-slate-300" />;
        return null;
      })}
    </div>
  );
}

// --- Creating ----------------------------------------------------------------------------------

function CreateTab({ templates, clients, orders }: { templates: Template[]; clients: Option[]; orders: { id: string; label: string }[] }) {
  const { t } = useI18n();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [clientId, setClientId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ id: string; name: string }[]>([]);
  const { pending, run } = useResult();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Pick label={t("docs.template")} value={templateId} onChange={setTemplateId} options={templates.map((tpl) => ({ id: tpl.id, name: tpl.name }))} placeholder={t("docs.chooseTemplate")} />
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t("docs.format")}</span>
            <div className="flex gap-2" role="radiogroup" aria-label={t("docs.format")}>
              {(["pdf", "docx"] as const).map((f) => (
                <Button key={f} type="button" role="radio" aria-checked={format === f} variant={format === f ? "secondary" : "outline"} onClick={() => setFormat(f)}>
                  {f === "pdf" ? "PDF" : "Word"}
                </Button>
              ))}
            </div>
          </div>
          {clients.length > 0 && <Pick label={t("docs.client")} value={clientId} onChange={setClientId} options={clients} none={t("docs.none")} />}
          {orders.length > 0 && <Pick label={t("docs.order")} value={orderId} onChange={setOrderId} options={orders.map((o) => ({ id: o.id, name: o.label }))} none={t("docs.none")} />}
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{t("docs.fileName")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </label>
          <div className="sm:col-span-2">
            <Button
              type="button"
              disabled={pending || !templateId}
              onClick={() =>
                run(
                  () => createDocumentAction({ templateId, clientId: clientId || null, orderId: orderId || null, format, name: name.trim() || undefined }),
                  (r) => r.id && r.name && setMade((list) => [{ id: r.id!, name: r.name! }, ...list]),
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus className="size-4" />} {t("docs.create")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {made.length > 0 && (
        <div className="grid content-start gap-2">
          {made.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
              <Button variant="ghost" size="icon" asChild aria-label={t("docs.openFile")}>
                <a href={fileHref(m.id)} target="_blank" rel="noopener">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
              <Button variant="ghost" size="icon" asChild aria-label={t("docs.download")}>
                <a href={fileHref(m.id, true)}>
                  <Download className="size-4" />
                </a>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pick({ label, value, onChange, options, none, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: Option[]; none?: string; placeholder?: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value || (none ? "-" : undefined)} onValueChange={(v) => onChange(v === "-" ? "" : v)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {none && <SelectItem value="-">{none}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// --- Converting --------------------------------------------------------------------------------

function ConvertTab({ files, ai }: { files: FileItem[]; ai: boolean }) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [pages, setPages] = useState("");
  const { pending, run } = useResult();
  const picked = chosen.map((id) => files.find((f) => f.id === id)).filter((f): f is FileItem => !!f);
  const one = picked.length === 1 ? picked[0] : null;
  const allImages = picked.length > 0 && picked.every((f) => IMAGES.has(f.mimeType));
  const allPdfs = picked.length > 0 && picked.every((f) => f.mimeType === PDF);
  const canPdf = (!!one && (one.mimeType === DOCX || one.mimeType === "text/plain" || IMAGES.has(one.mimeType))) || (picked.length > 1 && allImages);
  const canWord = !!one && (one.mimeType === "text/plain" || (ai && (one.mimeType === PDF || IMAGES.has(one.mimeType))));
  const shown = files.filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const done = () => setChosen([]);

  const toggle = (id: string) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <div className="grid gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
        <Button type="button" variant="outline" disabled={pending || !canPdf} onClick={() => run(() => (one && !allImages ? convertDocumentAction(one.id, "pdf") : imagesToPdfAction(chosen)), done)}>
          <FileImage className="size-4" /> {t("docs.toPdf")}
        </Button>
        <Button type="button" variant="outline" disabled={pending || !canWord} onClick={() => one && run(() => convertDocumentAction(one.id, "docx"), done)}>
          <FileText className="size-4" /> {t("docs.toWord")}
        </Button>
        <Button type="button" variant="outline" disabled={pending || !(allPdfs && picked.length > 1)} onClick={() => run(() => mergePdfsAction(chosen), done)}>
          <Files className="size-4" /> {t("docs.merge")}
        </Button>
        <div className="flex items-center gap-1">
          <Input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5" className="w-28" aria-label={t("docs.pages")} disabled={!(one && one.mimeType === PDF)} />
          <Button type="button" variant="outline" disabled={pending || !(one && one.mimeType === PDF) || !pages.trim()} onClick={() => one && run(() => extractPagesAction(one.id, pages), done)}>
            <Scissors className="size-4" /> {t("docs.extract")}
          </Button>
        </div>
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {picked.length > 0 && <span className="ml-auto text-sm text-muted-foreground">{t("docs.selected", { count: String(picked.length) })}</span>}
      </div>

      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("documents.search")} className="max-w-sm" aria-label={t("documents.search")} />

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("docs.noFiles")}</p>
      ) : (
        <div className="grid gap-1 rounded-xl border bg-card p-2">
          {shown.map((f) => {
            const at = chosen.indexOf(f.id);
            return (
              <label key={f.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent", at >= 0 && "bg-accent")}>
                <Checkbox checked={at >= 0} onCheckedChange={() => toggle(f.id)} aria-label={f.name} />
                <span className="w-5 text-center text-xs font-semibold tabular-nums text-primary">{at >= 0 ? at + 1 : ""}</span>
                {IMAGES.has(f.mimeType) ? <FileImage className="size-4 shrink-0 text-muted-foreground" /> : <FileText className={cn("size-4 shrink-0", f.mimeType === PDF ? "text-red-600" : f.mimeType === DOCX ? "text-blue-600" : "text-muted-foreground")} />}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <a href={fileHref(f.id)} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground" aria-label={t("docs.openFile")} onClick={(e) => e.stopPropagation()}>
                  <ExternalLink className="size-4" />
                </a>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
