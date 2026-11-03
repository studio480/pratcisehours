// @ts-nocheck
// ═══════════════════════════════════════════════════════════
// PH Studio Room — "notify" edge function
// Called by (1) a Database Webhook on the `items` table (INSERT, UPDATE)
//       and (2) a daily cron for the 9am digest ({ "type": "digest" }).
// Decides who should hear about a change and sends web push notifications.
// Secrets needed (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PH_WEBHOOK_SECRET
// ═══════════════════════════════════════════════════════════
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const TEAM = ["Abdullah", "Marcus", "Fatih"];
const TZ_OFFSET_HOURS = 4; // Dubai. Change to 0 for London (GMT) if the team moves.

// ── Pure rules: who hears about what ─────────────────────────
const others = (who) => TEAM.filter((n) => n !== who);
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
const localToday = (now = Date.now()) => new Date(now + TZ_OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);

export function planForChange(p) {
  const r = p.record || {};
  const o = p.old_record || {};
  const d = r.data || {};
  const od = o.data || {};
  const msgs = [];

  if (p.type === "INSERT") {
    const by = r.created_by;
    if (r.kind === "pin") {
      const urgent = d.category === "Urgent";
      msgs.push({ to: others(by), title: urgent ? `🔴 Urgent from ${by}` : `📌 ${by} pinned something`, body: r.title + (d.body ? ` — ${d.body.slice(0, 90)}` : ""), url: "/admin/#board", tag: `pin-${r.id}` });
    } else if (r.kind === "event") {
      const bits = [r.title, fmtDate(d.date), d.time, d.location].filter(Boolean).join(" · ");
      msgs.push({ to: others(by), title: `🗓 ${by} added to the calendar`, body: bits, url: "/admin/#calendar", tag: `event-${r.id}` });
    } else if (r.kind === "task" && d.owner && d.owner !== by) {
      msgs.push({ to: [d.owner], title: `✅ ${by} gave you a task`, body: r.title + (d.date ? ` · due ${fmtDate(d.date)}` : ""), url: "/admin/#tasks", tag: `task-${r.id}` });
    } else if (r.kind === "partner") {
      msgs.push({ to: others(by), title: `🤝 New partner from ${by}`, body: r.title + (d.status ? ` · ${d.status}` : ""), url: "/admin/#partners", tag: `partner-${r.id}` });
    }
  }

  if (p.type === "UPDATE") {
    const by = r.updated_by;
    if (r.kind === "task" && d.owner && d.owner !== od.owner && d.owner !== by) {
      msgs.push({ to: [d.owner], title: `✅ ${by} passed you a task`, body: r.title + (d.date ? ` · due ${fmtDate(d.date)}` : ""), url: "/admin/#tasks", tag: `task-${r.id}` });
    }
    if (r.kind === "task" && d.done && !od.done && r.created_by && r.created_by !== by) {
      msgs.push({ to: [r.created_by], title: `🎉 ${by} finished a task`, body: r.title, url: "/admin/#tasks", tag: `task-${r.id}` });
    }
    if (r.kind === "pin" && d.category === "Urgent" && od.category !== "Urgent") {
      msgs.push({ to: others(by), title: `🔴 ${by} marked a pin urgent`, body: r.title, url: "/admin/#board", tag: `pin-${r.id}` });
    }
    if (r.kind === "event" && (d.date !== od.date || d.time !== od.time)) {
      msgs.push({ to: others(by), title: `🗓 ${by} moved an event`, body: [r.title, fmtDate(d.date), d.time].filter(Boolean).join(" · "), url: "/admin/#calendar", tag: `event-${r.id}` });
    }
    if (r.kind === "content" && d.status === "Posted" && od.status !== "Posted") {
      msgs.push({ to: others(by), title: `🚀 ${by} posted it`, body: r.title, url: "/admin/#content", tag: `content-${r.id}` });
    }
    if (r.kind === "partner" && d.status === "Agreed" && od.status !== "Agreed") {
      msgs.push({ to: others(by), title: `🤝 Deal agreed`, body: `${r.title} — logged by ${by}`, url: "/admin/#partners", tag: `partner-${r.id}` });
    }
  }
  return msgs.filter((m) => m.to.length);
}

export function planDigest(items, now = Date.now()) {
  const today = localToday(now);
  const events = items.filter((i) => i.kind === "event" && i.data?.date === today)
    .sort((a, b) => (a.data.time || "").localeCompare(b.data.time || ""));
  const msgs = [];
  for (const person of TEAM) {
    const tasks = items.filter((i) => i.kind === "task" && !i.data?.done && i.data?.owner === person && i.data?.date && i.data.date <= today);
    const late = tasks.filter((t) => t.data.date < today).length;
    if (!events.length && !tasks.length) continue;
    const parts = [];
    if (events.length) parts.push(`Today: ${events.map((e) => (e.data.time ? e.data.time + " " : "") + e.title).join(", ")}`);
    if (tasks.length) parts.push(`${tasks.length} task${tasks.length > 1 ? "s" : ""} due${late ? ` (${late} late)` : ""}: ${tasks.map((t) => t.title).slice(0, 3).join(", ")}`);
    msgs.push({ to: [person], title: `☀️ Morning, ${person}`, body: parts.join(" · "), url: events.length ? "/admin/#calendar" : "/admin/#tasks", tag: `digest-${today}` });
  }
  return msgs;
}

// ── Sending ───────────────────────────────────────────────────
if (typeof Deno !== "undefined") {
  const SECRET = Deno.env.get("PH_WEBHOOK_SECRET");
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:studio@indiebycinema.com",
    Deno.env.get("VAPID_PUBLIC_KEY"),
    Deno.env.get("VAPID_PRIVATE_KEY"),
  );
  const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  async function send(msgs) {
    if (!msgs.length) return { sent: 0, removed: 0 };
    const { data: subs, error } = await db.from("push_subs").select("endpoint, who, sub");
    if (error) throw error;
    let sent = 0, removed = 0;
    for (const m of msgs) {
      const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag });
      for (const s of (subs || []).filter((x) => m.to.includes(x.who))) {
        try {
          await webpush.sendNotification(s.sub, payload, { TTL: 60 * 60 * 12 });
          sent++;
        } catch (e) {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) {
            await db.from("push_subs").delete().eq("endpoint", s.endpoint); // phone unsubscribed or reinstalled
            removed++;
          } else console.error("push failed", s.who, e && (e.statusCode || e.message));
        }
      }
    }
    return { sent, removed };
  }

  Deno.serve(async (req) => {
    if (!SECRET || req.headers.get("x-ph-secret") !== SECRET) return new Response("unauthorised", { status: 401 });
    let p = {};
    try { p = await req.json(); } catch (_) { /* empty body */ }
    try {
      let msgs = [];
      if (p.type === "digest") {
        const { data, error } = await db.from("items").select("kind, title, data").in("kind", ["event", "task"]);
        if (error) throw error;
        msgs = planDigest(data || []);
      } else if (p.type === "test") {
        msgs = [{ to: TEAM, title: "👋 Studio Room is live", body: "Notifications are working.", url: "/admin/", tag: "test" }];
      } else if (p.table === "items") {
        msgs = planForChange(p);
      }
      const result = await send(msgs);
      return Response.json({ ok: true, planned: msgs.length, ...result });
    } catch (e) {
      console.error(e);
      return Response.json({ ok: false, error: String(e && e.message || e) }, { status: 500 });
    }
  });
}
