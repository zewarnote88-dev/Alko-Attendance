// Supabase Edge Function: shift-alert
// Sends a phone notification 1 hour before each shift ends, listing workers of that shift
// who still have no data (came / absent / leave) for the current work day.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_EMAIL") || "admin@alko.app"), Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

const ADM = "zewar";
const TZ = 3; // Iraq, UTC+3 all year
const SHT: [string, number, string][] = [["سپێدە", 16, "☀️"], ["ئێڤار", 24, "🌇"], ["شەڤ", 32, "🌙"]];
const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
const addD = (s: string, n: number) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const weekOf = (s: string) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 1) % 7)); return iso(x); };
const aKey = (d: string) => weekOf(addD(d, 1));

async function getDoc(path: string) {
  const { data } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
  return (data?.data ?? {}) as Record<string, any>;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const test = url.searchParams.get("test") === "1";

  const local = new Date(Date.now() + TZ * 3600e3);                 // local wall-clock as UTC fields
  const D = iso(new Date(local.getTime() - 8 * 3600e3));            // work day (changes at 08:00)
  const hrs = (local.getTime() - new Date(D + "T00:00:00Z").getTime()) / 3600e3;
  const forced = url.searchParams.get("shift");
  const due = SHT.filter(([sh, end]) => forced ? sh === forced : hrs >= end - 1.25 && hrs < end);

  const cfg = await getDoc("app/config"), day = await getDoc("days/" + D), wk = await getDoc("weeks/" + aKey(D));
  const workers: any[] = cfg.workers || [], users: any[] = cfg.users || [];
  const has = (id: string) => !!((day.pr || {})[id] || ((day.abs || {})[id] || 0) > 0 || (day.lv || {})[id]);
  const active = (w: any) => !(w.start && D < w.start) && !(w.end && D > w.end);

  const msgs = (test && !due.length ? [["سپێدە", 16, "☀️"] as [string, number, string]] : due).map(([sh, end, ic]) => {
    const L = workers.filter((w) => active(w) && ((wk.a || {})[w.id] || [])[2] === sh && !has(w.id));
    const left = Math.max(0, Math.round((end - hrs) * 60));
    return { sh, ic, L, left };
  }).filter((m) => m.L.length || test);
  if (!msgs.length) return Response.json({ ok: true, day: D, sent: 0, note: "nothing missing" });

  const { data: subs } = await sb.from("docs").select("path,data").like("path", "push/%");
  const allowed = (u: string) => u === ADM || users.some((x) => x.u === u && ((x.perms || []).includes("1")));
  let sent = 0;
  for (const m of msgs) {
    const names = m.L.slice(0, 8).map((w: any) => w.name).join("، ") + (m.L.length > 8 ? "، +" + (m.L.length - 8) : "");
    const payload = JSON.stringify({
      title: `${m.ic} دەوامێ ${m.sh}` + (m.left ? ` د ناڤ ${m.left} خولەکان دا ب دووماهی دهێت` : " ب دووماهی هات"),
      body: m.L.length ? `${m.L.length} کرێکار هێشتا داتا بۆ نەهاتیە داخلکرن: ${names}` : "تاقیکرن: ئاگەهدارکرن کار دکەن ✅",
      tag: "shift-" + D + "-" + m.sh, url: "./",
    });
    for (const r of subs || []) {
      const s = r.data || {};
      if (!s.sub || !allowed(s.u)) continue;
      try { await webpush.sendNotification(s.sub, payload, { TTL: 3600 }); sent++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("docs").delete().eq("path", r.path); }
    }
  }
  return Response.json({ ok: true, day: D, sent, shifts: msgs.map((m) => ({ shift: m.sh, missing: m.L.length })) });
});
