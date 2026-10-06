/**
 * AI chat data layer: message/conversation model, localStorage persistence
 * (with an in-memory cache), and the real streaming transport that talks to
 * the `ai-chat` edge function.
 */
import { HAS_BACKEND, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './siteConfig';
import { DEFAULT_MODEL_ID, getModel } from './aiModels';

export type Role = 'user' | 'assistant';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: 'image' | 'text';
  /** data URL for images, raw text for text files */
  data: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  messages: ChatMessage[];
  pinned?: boolean;
  folderId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

const CONV_KEY = 'snoopy.ai.conversations.v2';
const FOLDER_KEY = 'snoopy.ai.folders.v1';

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ------------------------------- persistence ------------------------------ */

let convCache: Conversation[] | null = null;
let folderCache: Folder[] | null = null;

const read = <T,>(key: string): T[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
};

export const loadConversations = (): Conversation[] => {
  if (convCache) return convCache;
  const list = read<Conversation>(CONV_KEY).map((c) => ({
    ...c,
    modelId: c.modelId || DEFAULT_MODEL_ID,
    messages: Array.isArray(c.messages) ? c.messages : [],
  }));
  convCache = list;
  return list;
};

export const saveConversations = (list: Conversation[]) => {
  convCache = list;
  write(CONV_KEY, list);
};

export const loadFolders = (): Folder[] => {
  if (folderCache) return folderCache;
  folderCache = read<Folder>(FOLDER_KEY);
  return folderCache;
};

export const saveFolders = (list: Folder[]) => {
  folderCache = list;
  write(FOLDER_KEY, list);
};

/* --------------------------------- factories ------------------------------ */

export const createConversation = (modelId = DEFAULT_MODEL_ID, folderId: string | null = null): Conversation => {
  const now = Date.now();
  return {
    id: uid(),
    title: 'New chat',
    modelId,
    messages: [],
    pinned: false,
    folderId,
    createdAt: now,
    updatedAt: now,
  };
};

export const createMessage = (
  role: Role,
  content: string,
  attachments?: Attachment[],
): ChatMessage => ({
  id: uid(),
  role,
  content,
  createdAt: Date.now(),
  ...(attachments && attachments.length ? { attachments } : {}),
});

export const deriveTitle = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 44 ? clean.slice(0, 44) + '…' : clean;
};

export const sortConversations = (list: Conversation[]) =>
  [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

/* -------------------------------- transport ------------------------------- */

/** Backend endpoint; empty when this deployment has no backend configured. */
const ENDPOINT = HAS_BACKEND ? `${SUPABASE_URL}/functions/v1/ai-chat` : '';

/** True when the AI page can actually reach a backend. */
export const AI_CONFIGURED = HAS_BACKEND;

export class AIError extends Error {}

/**
 * Streams an assistant reply from the backend.
 * @param history  full prior turns (context memory)
 * @param modelId  which specialised assistant to use
 * @param onChunk  called for every streamed token
 */
export async function streamAssistantReply(
  history: ChatMessage[],
  modelId: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const spec = getModel(modelId);

  if (!ENDPOINT) {
    throw new AIError(
      'AI backend is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for your own project, then deploy supabase/functions/ai-chat to it.',
    );
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      assistant: spec.id,
      messages: history
        .filter((m) => !m.error)
        .map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments?.map((a) => ({
            name: a.name,
            mime: a.mime,
            kind: a.kind,
            data: a.data,
          })),
        })),
    }),
  });

  if (!res.ok || !res.body) {
    let message = `AI request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) message = j.error;
    } catch {
      /* ignore */
    }
    throw new AIError(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      full += text;
      onChunk(text);
    }
  }
  return full;
}

/* ------------------------------- attachments ------------------------------ */

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const TEXTY = /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|sql))/;

export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  const isImage = file.type.startsWith('image/');
  const isText = TEXTY.test(file.type) || /\.(md|txt|csv|log|ts|tsx|js|jsx|py|java|cs|cpp|rs|go|sql|html|css|json|yml|yaml)$/i.test(file.name);
  if (!isImage && !isText) return null;

  const data = isImage
    ? await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      })
    : await file.text();

  return {
    id: uid(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    kind: isImage ? 'image' : 'text',
    data,
    size: file.size,
  };
}
