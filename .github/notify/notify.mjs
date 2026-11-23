// Daily reminder: who did not enter yesterday's attendance data. Sends Web Push to subscribed phones.
// Runs in GitHub Actions (see .github/workflows/notify.yml). Reads the same Supabase "docs" table the app uses.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");

const SB_URL = "https://bkusrcbotmboazzhdwxo.supabase.co";
const SB_KEY = "sb_publishable_0LrbeEfUoZLZdArhHPIRZw_ogxJlu9T";
const VAPID_PUBLIC = "BDfsd6KRd4wqVAzJ5D6-FDB4CLIZCTt9N3L-LNoOA2GFz_i_-YhoHjs3_MPu5_t4gUaqvrnisOuL7O0yzhh2JGg";
const ADM = "zewar";
const APP = "https://zewarnote88-dev.github.io/Alko-Attendance/";

if (!process.env.VAPID_PRIVATE) { console.error("Missing secret VAPID_PRIVATE (GitHub → Settings → Secrets and variables → Actions)"); process.exit(1); }
webpush.setVapidDetails("mailto:alko@example.com", VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const p2 = n => String(n).padStart(2, "0");
const iso = d => d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
const addD = (s, n) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const dow = s => new Date(s + "T00:00:00Z").getUTCDay();
const weekOf = s => addD(s, -((dow(s) + 1) % 7));            // Saturday of the week
const aKey = d => weekOf(addD(d, 1));                        // arrangement key (Fri→Thu)
// work day runs 08:00→08:00 Baghdad (UTC+3)
const wtoday = () => iso(new Date(Date.now() + 3 * 3600e3 - 8 * 3600e3));
const dm = d => d.slice(8) + "/" + d.slice(5, 7);
const DN = ["یەکشەمب", "دووشەمب", "سێشەمب", "چارشەمب", "پێنجشەمب", "ئەینی", "شەمبی"];

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { error: ae } = await sb.auth.signInAnonymously();
if (ae) throw ae;
const MODE = process.env.MODE || "daily";
const day = wtoday(), d = MODE === "shift" ? day : addD(day, -1);
const rows = async q => { const { data, error } = await q; if (error) throw error; return data || []; };
const cfg = (await rows(sb.from("docs").select("data").eq("path", "app/config")))[0]?.data || {};
const D = (await rows(sb.from("docs").select("data").eq("path", "days/" + d)))[0]?.data || {};
const A = (await rows(sb.from("docs").select("data").eq("path", "weeks/" + aKey(d))))[0]?.data?.a || {};
const subs = await rows(sb.from("docs").select("path,data").like("path", "push/%"));
console.log("day", d, "subs", subs.length);

const SEC0 = { id: "sabgh", name: "قاعة الصبغ", type: "shift" };
const secs = (cfg.sections || []).filter(x => x && x.id);
const SECS = secs.some(x => x.id === "sabgh") ? secs : [SEC0, ...secs];
const secOf = w => w.sec || "sabgh";
const secById = id => SECS.find(x => x.id === id) || SEC0;
const outside = w => (w.start && d < w.start) || (w.end && d > w.end);
const dayOff = w => { const s = secById(secOf(w)); return s.type === "day" && s.fri !== false && dow(d) === 5; };
const has = (k, w) => D[k] && D[k][w.id] != null && D[k][w.id] !== 0;
const hasData = w => has("pr", w) || (D.abs && D.abs[w.id] > 0) || has("lv", w);
const users = cfg.users || [];

// groups: per section, split by machine when the section's users are bound to machines
const groups = [];
for (const c of SECS) {
  const WS = (cfg.workers || []).filter(w => secOf(w) === c.id && !outside(w) && !dayOff(w));
  if (!WS.length) continue;
  const U = users.filter(u => (u.sec || "sabgh") === c.id && (u.sadm || (u.perms || []).includes("1")));
  const byPl = U.some(u => (u.pls || []).length), G = new Map();
  for (const w of WS) { const g = byPl ? ((A[w.id] || [])[1] || "بێ جه") : ""; if (!G.has(g)) G.set(g, []); G.get(g).push(w); }
  for (const [g, L] of G) {
    const miss = L.filter(w => !hasData(w)).length;
    groups.push({ sec: c, g, n: L.length, miss, resp: U.filter(u => !byPl || !(u.pls || []).length || u.pls.includes(g)).map(u => u.u) });
  }
}
const line = x => `${x.g ? x.sec.name + " · " + x.g : x.sec.name}: ${x.miss === x.n ? "هیچ داتا نەهاتیە داخلکرن" : x.miss + " ژ " + x.n + " کرێکار بێ داتا"}${x.resp.length ? " (" + x.resp.join("، ") + ")" : ""}`;

function scopeOf(u) {
  if (u === ADM) return groups;
  const x = users.find(v => v.u === u); if (!x) return null;
  if (x.sec === "*") return groups;
  const S = groups.filter(g => g.sec.id === (x.sec || "sabgh"));
  if (x.sadm) return S;
  return S.filter(g => g.resp.includes(u));
}

const test = String(process.env.TEST) === "true";
if (MODE === "shift" && !test) { await shiftMode(); process.exit(0); }
let sent = 0, gone = 0;
for (const r of subs) {
  const s = r.data || {}; if (!s.sub || !s.u) continue;
  const sc = scopeOf(s.u); if (!sc) { await sb.from("docs").delete().eq("path", r.path); gone++; continue; }
  const bad = sc.filter(g => g.miss);
  let payload;
  if (test) payload = { title: "🔔 تاقیکرن · ALKO", body: "ئاگەهداری ب سەرکەفتی گەهشتنە ڤی مۆبایلی ✅", tag: "alko-test" };
  else if (!bad.length) continue;
  else {
    const mine = s.u !== ADM && !users.find(v => v.u === s.u)?.sadm && users.find(v => v.u === s.u)?.sec !== "*";
    payload = {
      title: mine ? `⚠️ داتایا دوهی نەتەمامە · ${DN[dow(d)]} ${dm(d)}` : `🔔 ${bad.length} کۆم داتا نەتەمامە · ${DN[dow(d)]} ${dm(d)}`,
      body: bad.slice(0, 6).map(line).join("\n") + (bad.length > 6 ? `\n+${bad.length - 6} یێن دی` : ""),
      tag: "alko-" + d
    };
  }
  payload.url = APP;
  try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600 }); sent++; }
  catch (e) {
    console.log("fail", s.u, e.statusCode);
    if (e.statusCode === 404 || e.statusCode === 410) { await sb.from("docs").delete().eq("path", r.path); gone++; }
  }
}
console.log("groups", groups.length, "incomplete", groups.filter(g => g.miss).length, "sent", sent, "removed", gone);

// ===== Shift mode: ~1 hour before a shift ends, remind the users the admin marked (⏰) about workers still without data =====
async function shiftMode() {
  const hrs = (Date.now() + 3 * 3600e3 - Date.parse(d + "T00:00:00Z")) / 36e5;
  const ROLES = ["کرێکار", "هۆستا", "مراقب", "هۆستایێ بەشەکی"];
  const roleOf = w => ROLES.includes(w.role) ? w.role : "کرێکار";
  const isK = w => ["کرێکار", "هۆستایێ بەشەکی"].includes(roleOf(w));
  const dayH = (w, c) => c.type === "day" ? (+c.h || 8) : (isK(w) ? 8 : 12);
  const endOf = (w, c, sh) => c.type === "day" ? 8 + dayH(w, c)
    : sh === "سپێدە" ? 8 + dayH(w, c) : sh === "ئێڤار" ? 16 + dayH(w, c) : sh === "شەڤ" ? 32
    : sh === "شفتی 1" ? 20 : sh === "شفتی 2" ? 32 : null;
  const pend = [];   // workers whose shift ends within the next ~2 hours and still have no data
  for (const w of (cfg.workers || [])) {
    if (outside(w) || dayOff(w) || hasData(w)) continue;
    const c = secById(secOf(w)), a = A[w.id] || ["", "", ""], end = endOf(w, c, a[2]);
    if (end == null || end <= hrs || end > hrs + 2) continue;
    pend.push({ w, c, pl: a[1] || "", sh: a[2] || "", end });
  }
  console.log("shift mode", d, "hrs", hrs.toFixed(2), "pending", pend.length);
  if (!pend.length) return;
  let sent = 0;
  for (const r of subs) {
    const s = r.data || {}; if (!s.sub || !s.u) continue;
    const x = users.find(v => v.u === s.u); if (!x || !x.shn) continue;
    const L = pend.filter(p => (x.sec === "*" || p.c.id === (x.sec || "sabgh")) && (x.sadm || x.sec === "*" || !(x.pls || []).length || x.pls.includes(p.pl)));
    if (!L.length) continue;
    const shs = [...new Set(L.map(p => p.sh || p.c.name))].join("، ");
    const mins = Math.max(0, Math.round((Math.min(...L.map(p => p.end)) - hrs) * 60));
    const payload = {
      title: `⏰ دەوامێ ${shs} د ناڤ ${mins >= 50 && mins <= 75 ? "1 دەمژمێرێ" : mins + " خولەکان"} دا ب دووماهی دهێت`,
      body: `${L.length} کرێکار هێشتا داتا (هاتیە / نەهاتیە / مۆلەت) بۆ نەهاتیە داخلکرن:\n` + L.slice(0, 10).map(p => p.w.name + (p.w.code ? " (" + p.w.code + ")" : "")).join("، ") + (L.length > 10 ? ` +${L.length - 10}` : ""),
      tag: "alko-shift-" + d + "-" + shs, url: APP
    };
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600 }); sent++; }
    catch (e) { console.log("fail", s.u, e.statusCode); if (e.statusCode === 404 || e.statusCode === 410) await sb.from("docs").delete().eq("path", r.path); }
  }
  console.log("sent", sent);
}
