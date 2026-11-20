import { Channel, invoke } from "@tauri-apps/api/core";
import { editor, languages, MarkerSeverity, Range, Uri } from "monaco-editor/esm/vs/editor/editor.api.js";

type Point = { line: number; character: number };
type SourceRange = { start: Point; end: Point };
type Diagnostic = { range: SourceRange; message: string; severity?: number; source?: string };
type WorkspaceLocation = { uri: string; range: SourceRange };
type Completion = {
  label: string; kind?: number; detail?: string; insertText?: string; insertTextFormat?: number;
  documentation?: string | { value: string }; textEdit?: { newText: string; range?: SourceRange; replace?: SourceRange };
};
type Packet = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
const position = (lineNumber: number, column: number): Point => ({ line: lineNumber - 1, character: column - 1 });
function toRange(value: SourceRange) {
  return new Range(value.start.line + 1, value.start.character + 1, value.end.line + 1, value.end.character + 1);
}
const severity = [MarkerSeverity.Error, MarkerSeverity.Warning, MarkerSeverity.Info, MarkerSeverity.Hint];
const kinds = languages.CompletionItemKind;
const lspKinds = [
  kinds.Text, kinds.Method, kinds.Function, kinds.Constructor, kinds.Field, kinds.Variable,
  kinds.Class, kinds.Interface, kinds.Module, kinds.Property, kinds.Unit, kinds.Value,
  kinds.Enum, kinds.Keyword, kinds.Snippet, kinds.Color, kinds.File, kinds.Reference,
  kinds.Folder, kinds.EnumMember, kinds.Constant, kinds.Struct, kinds.Event, kinds.Operator, kinds.TypeParameter,
];

export class SwiftLanguage {
  private id = 0;
  private active = true;
  private ready = false;
  private queue = Promise.resolve();
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; timer: number }>();
  private readonly documents = new Map<string, { model: editor.ITextModel; subscription: { dispose(): void } }>();
  private readonly interfaces = new Set<editor.ITextModel>();
  private readonly providers: { dispose(): void }[] = [];

  constructor(private readonly root: string, private readonly onStatus: (status: string) => void) {}

  async start() {
    const messages = new Channel<Packet>();
    messages.onmessage = packet => this.receive(packet);
    this.onStatus("Starting SourceKit");
    try {
      await invoke("language_start", { root: this.root, messages });
      if (!this.active) return;
      const rootUri = Uri.file(this.root).toString();
      const result = await this.request("initialize", {
        processId: null, rootUri, workspaceFolders: [{ uri: rootUri, name: this.root.split("/").at(-1) }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: {
            completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] } },
            hover: { contentFormat: ["markdown", "plaintext"] },
          },
        },
      }, 30_000);
      if (!this.active) return;
      if (result === null) {
        this.onStatus("SourceKit did not initialize");
        return;
      }
      this.notify("initialized", {});
      this.ready = true;
      this.registerProviders();
      for (const { model } of this.documents.values()) this.open(model);
      this.onStatus("SourceKit ready");
    } catch (error) {
      if (this.active) this.onStatus(String(error));
    }
  }

  track(model: editor.ITextModel) {
    if (model.getLanguageId() !== "swift") return;
    const uri = model.uri.toString();
    const subscription = model.onDidChangeContent(() => {
      if (!this.ready) return;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }],
      });
    });
    this.documents.set(uri, { model, subscription });
    if (this.ready) this.open(model);
  }

  untrack(model: editor.ITextModel) {
    const uri = model.uri.toString();
    const tracked = this.documents.get(uri);
    if (!tracked) return;
    tracked.subscription.dispose();
    this.documents.delete(uri);
    editor.setModelMarkers(model, "sourcekit", []);
    if (this.ready) this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  dispose() {
    this.active = false;
    this.ready = false;
    for (const provider of this.providers) provider.dispose();
    for (const tracked of this.documents.values()) {
      tracked.subscription.dispose();
      if (!tracked.model.isDisposed()) editor.setModelMarkers(tracked.model, "sourcekit", []);
    }
    for (const entry of this.waiting.values()) {
      window.clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.waiting.clear();
    this.documents.clear();
    for (const model of this.interfaces) model.dispose();
    this.interfaces.clear();
  }

  private send(packet: Packet) {
    this.queue = this.queue.then(async () => {
      if (this.active) await invoke("language_send", { message: { jsonrpc: "2.0", ...packet } });
    }).catch(error => {
      if (this.active) this.onStatus(String(error));
    });
  }

  private notify(method: string, params: unknown) {
    this.send({ method, params });
  }

  private request(method: string, params: unknown, timeout = 15_000): Promise<unknown> {
    if (!this.active) return Promise.resolve(null);
    const id = ++this.id;
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        if (this.waiting.delete(id)) resolve(null);
      }, timeout);
      this.waiting.set(id, { resolve, timer });
      this.send({ id, method, params });
    });
  }

  private receive(packet: Packet) {
    if (!this.active) return;
    if (packet.method === "swiftforge/serverStopped") {
      this.onStatus("SourceKit stopped");
      this.dispose();
    } else if (packet.method === "textDocument/publishDiagnostics") {
      const { uri, diagnostics = [] } = packet.params as { uri: string; diagnostics: Diagnostic[] };
      const model = this.documents.get(uri)?.model;
      if (model) editor.setModelMarkers(model, "sourcekit", diagnostics.map(item => ({
        ...toRange(item.range), message: item.message, source: item.source || "SourceKit",
        severity: severity[(item.severity ?? 1) - 1] ?? MarkerSeverity.Error,
      })));
    } else if (packet.method && packet.id !== undefined) {
      const params = packet.params as { items?: unknown[] } | undefined;
      const result = packet.method === "workspace/configuration" ? (params?.items ?? []).map(() => null) :
        packet.method === "workspace/applyEdit" ? { applied: false } : null;
      this.send({ id: packet.id, result });
    } else if (typeof packet.id === "number") {
      const entry = this.waiting.get(packet.id);
      if (entry) {
        this.waiting.delete(packet.id);
        window.clearTimeout(entry.timer);
        entry.resolve(packet.error ? null : packet.result ?? null);
      }
    }
  }

  private open(model: editor.ITextModel) {
    this.notify("textDocument/didOpen", {
      textDocument: { uri: model.uri.toString(), languageId: "swift", version: model.getVersionId(), text: model.getValue() },
    });
  }

  private registerProviders() {
    function params(model: editor.ITextModel, at: { lineNumber: number; column: number }) {
      return { textDocument: { uri: model.uri.toString() }, position: position(at.lineNumber, at.column) };
    }
    this.providers.push(
      languages.registerCompletionItemProvider("swift", {
        triggerCharacters: [".", "("],
        provideCompletionItems: async (model, at) => {
          if (!this.documents.has(model.uri.toString())) return { suggestions: [] };
          const result = await this.request("textDocument/completion", params(model, at)) as Completion[] | { items: Completion[]; isIncomplete?: boolean } | null;
          const items = Array.isArray(result) ? result : result?.items ?? [];
          const word = model.getWordUntilPosition(at);
          const fallback = new Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn);
          return {
            incomplete: Array.isArray(result) ? false : result?.isIncomplete,
            suggestions: items.map(item => {
              const range = item.textEdit?.range ?? item.textEdit?.replace;
              return {
                label: item.label, kind: lspKinds[(item.kind ?? 1) - 1] ?? kinds.Text,
                detail: item.detail, insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
                insertTextRules: item.insertTextFormat === 2 ? languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
                range: range ? toRange(range) : fallback,
              };
            }),
          };
        },
      }),
      languages.registerSignatureHelpProvider("swift", {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (model, at) => {
          if (!this.documents.has(model.uri.toString())) return null;
          type Documentation = string | { value: string };
          const result = await this.request("textDocument/signatureHelp", params(model, at)) as {
            signatures: { label: string; documentation?: Documentation; parameters?: { label: string | [number, number]; documentation?: Documentation }[] }[];
            activeSignature?: number; activeParameter?: number;
          } | null;
          if (!result?.signatures.length) return null;
          const text = (doc?: Documentation) => typeof doc === "string" ? doc : doc?.value;
          return {
            dispose() {},
            value: {
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0,
              signatures: result.signatures.map(item => ({
                label: item.label, documentation: text(item.documentation),
                parameters: (item.parameters ?? []).map(parameter => ({
                  label: parameter.label, documentation: text(parameter.documentation),
                })),
              })),
            },
          };
        },
      }),
      languages.registerHoverProvider("swift", {
        provideHover: async (model, at) => {
          if (!this.documents.has(model.uri.toString())) return null;
          const result = await this.request("textDocument/hover", params(model, at)) as {
            contents: string | { value: string } | (string | { value: string })[]; range?: SourceRange;
          } | null;
          if (!result) return null;
          const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
          return { contents: contents.map(item => ({ value: typeof item === "string" ? item : item.value })),
            range: result.range ? toRange(result.range) : undefined };
        },
      }),
      languages.registerDefinitionProvider("swift", {
        provideDefinition: async (model, at) => {
          if (!this.documents.has(model.uri.toString())) return null;
          const result = await this.request("textDocument/definition", params(model, at)) as WorkspaceLocation[] | WorkspaceLocation | null;
          if (!result) return null;
          const definitions = (Array.isArray(result) ? result : [result]).filter(item => item.uri && item.range)
            .map(item => ({ uri: Uri.parse(item.uri), range: toRange(item.range) }));
          return (await Promise.all(definitions.map(async definition => {
            const { uri } = definition;
            if (uri.scheme !== "file" || uri.fsPath.startsWith(this.root + "/")) return definition;
            try {
              if (!editor.getModel(uri)) {
                const source = await invoke<string>("read_generated_interface", { path: uri.fsPath });
                if (!this.active) return null;
                if (!editor.getModel(uri)) this.interfaces.add(editor.createModel(source, "swift", uri));
              }
              return definition;
            } catch {
              return null;
            }
          }))).filter(definition => definition !== null);
        },
      }),
    );
  }
}
