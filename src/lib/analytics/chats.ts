/** Read side of the conversation and visit history pages under /analytics. Times are Central (see queries.ts). */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { readRecord, type AssistantRecord, type UserRecord } from "../chat-log";
import { RANGES, type RangeKey } from "./queries";

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db!.execute(q)).rows as T[];

/** Start of a range; "all" is the epoch. */
export function sinceFor(range: RangeKey, now = new Date()): Date {
  const h = RANGES[range].hours;
  return h ? new Date(now.getTime() - h * 3_600_000) : new Date(0);
}

export interface VisitInfo {
  id: string;
  visitorId: string;
  startedAt: Date;
  lastSeenAt: Date;
  seconds: number;
  pageviews: number;
  chats: number;
  entryPath: string | null;
  referrer: string | null;
  place: string;
  device: string | null;
  browser: string | null;
  os: string | null;
}

export interface ConversationSummary {
  id: string;
  startedAt: Date;
  lastAt: Date;
  questions: number;
  firstQuestion: string;
  sessionId: string | null;
  visitorId: string | null;
  inputTokens: number;
  outputTokens: number;
  hadError: boolean;
  /** Where the visit came from, when the conversation is tied to one. */
  place: string | null;
  device: string | null;
}

export interface ChatRow {
  id: number;
  role: string;
  record: UserRecord | AssistantRecord;
  model: string | null;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  messages: ChatRow[];
  visit: VisitInfo | null;
  visitorId: string | null;
}

export interface VisitEvent {
  type: string;
  path: string;
  at: Date;
}

export interface VisitDetail {
  visit: VisitInfo;
  events: VisitEvent[];
  conversations: ConversationSummary[];
  /** This visitor's other visits, newest first. */
  otherVisits: VisitInfo[];
}

interface VisitRow {
  id: string;
  visitor_id: string;
  started_at: Date;
  last_seen_at: Date;
  seconds: number;
  pageviews: number;
  chats: number;
  entry_path: string | null;
  referrer: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}

export const place = (x: { city: string | null; region: string | null; country: string | null }) =>
  [x.city, x.region, x.country].filter(Boolean).join(", ") || "Unknown";

const asVisit = (x: VisitRow): VisitInfo => ({
  id: x.id,
  visitorId: x.visitor_id,
  startedAt: new Date(x.started_at),
  lastSeenAt: new Date(x.last_seen_at),
  seconds: x.seconds,
  pageviews: x.pageviews,
  chats: x.chats,
  entryPath: x.entry_path,
  referrer: x.referrer,
  place: place(x),
  device: x.device,
  browser: x.browser,
  os: x.os,
});

const VISIT_COLS = sql`
  s.id, s.visitor_id, s.started_at, s.last_seen_at, extract(epoch from s.last_seen_at - s.started_at)::float as seconds,
  s.pageviews, s.entry_path, s.referrer, s.city, s.region, s.country, s.device, s.browser, s.os,
  (select count(*)::int from analytics_events e where e.session_id = s.id and e.type = 'chat') as chats`;

/** Visits that started in the range, newest first. */
export async function listVisits(since: Date, limit = 200): Promise<VisitInfo[]> {
  const r = await rows<VisitRow>(sql`select ${VISIT_COLS} from analytics_sessions s where s.started_at >= ${since} order by s.started_at desc limit ${limit}`);
  return r.map(asVisit);
}

async function visitById(id: string): Promise<VisitInfo | null> {
  const [r] = await rows<VisitRow>(sql`select ${VISIT_COLS} from analytics_sessions s where s.id = ${id}`);
  return r ? asVisit(r) : null;
}

interface ConversationRow {
  id: string;
  started_at: Date;
  last_at: Date;
  questions: number;
  first_question: string | null;
  session_id: string | null;
  visitor_id: string | null;
  input_tokens: number;
  output_tokens: number;
  had_error: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
}

const asConversation = (x: ConversationRow): ConversationSummary => ({
  id: x.id,
  startedAt: new Date(x.started_at),
  lastAt: new Date(x.last_at),
  questions: x.questions,
  firstQuestion: x.first_question ?? "",
  sessionId: x.session_id,
  visitorId: x.visitor_id,
  inputTokens: x.input_tokens,
  outputTokens: x.output_tokens,
  hadError: x.had_error,
  place: x.session_id ? place(x) : null,
  device: x.device,
});

/** Conversations (grouped questions and answers) newest first, with their visit's place and device when known. */
async function conversations(where: ReturnType<typeof sql>, limit: number): Promise<ConversationSummary[]> {
  const r = await rows<ConversationRow>(sql`
    select c.*, s.city, s.region, s.country, s.device from (
      select conversation_id as id, min(created_at) as started_at, max(created_at) as last_at,
        count(*) filter (where role = 'user')::int as questions,
        (array_agg(content->>'text' order by created_at, id) filter (where role = 'user'))[1] as first_question,
        max(session_id) as session_id, max(visitor_id) as visitor_id,
        coalesce(sum((content->'usage'->>'input')::int), 0)::int as input_tokens,
        coalesce(sum((content->'usage'->>'output')::int), 0)::int as output_tokens,
        bool_or(content ? 'error') as had_error
      from chat_messages where conversation_id <> '' and ${where}
      group by conversation_id) c
    left join analytics_sessions s on s.id = c.session_id
    order by c.started_at desc limit ${limit}`);
  return r.map(asConversation);
}

export const listConversations = (since: Date, limit = 100) => conversations(sql`created_at >= ${since}`, limit);

export async function getConversation(id: string): Promise<Conversation | null> {
  const r = await rows<{ id: number; role: string; content: unknown; model: string | null; created_at: Date; session_id: string | null; visitor_id: string | null }>(
    sql`select id, role, content, model, created_at, session_id, visitor_id from chat_messages where conversation_id = ${id} order by created_at, id`,
  );
  if (r.length === 0) return null;
  const sessionId = r.find((x) => x.session_id)?.session_id ?? null;
  return {
    id,
    messages: r.map((x) => ({ id: x.id, role: x.role, record: readRecord(x.role, x.content), model: x.model, createdAt: new Date(x.created_at) })),
    visit: sessionId ? await visitById(sessionId) : null,
    visitorId: r.find((x) => x.visitor_id)?.visitor_id ?? null,
  };
}

export async function getVisit(id: string): Promise<VisitDetail | null> {
  const visit = await visitById(id);
  if (!visit) return null;
  const [events, convos, others] = await Promise.all([
    rows<{ type: string; path: string; at: Date }>(sql`select type, path, at from analytics_events where session_id = ${id} order by at, id`),
    conversations(sql`session_id = ${id}`, 50),
    rows<VisitRow>(sql`select ${VISIT_COLS} from analytics_sessions s where s.visitor_id = ${visit.visitorId} and s.id <> ${id} order by s.started_at desc limit 20`),
  ]);
  return {
    visit,
    events: events.map((e) => ({ type: e.type, path: e.path, at: new Date(e.at) })),
    conversations: convos,
    otherVisits: others.map(asVisit),
  };
}
