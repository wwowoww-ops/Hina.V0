const fs = require("fs");
const path = require("path");

module.exports.config = {
    name: "قبول",
    version: "10.4.0",
    hasPermssion: 1,
    credits: "أبو هريرة",
    description: "إدارة طلبات الانضمام بالرد على القائمة",
    commandCategory: "admin",
    usages: "قبول (ثم رد على القائمة برقم / الكل / رفض رقم / رفض الكل / إلغاء)",
    cooldowns: 5
};

const H = "⌬ ━━ HINA ADMIN ━━ ⌬\n\n";
const RETRY_AFTER = 6 * 60 * 60 * 1000; // لا نعيد تجربة من فشل قبله قبل 6 ساعات
const MAX_PER_RUN = 15;
const SHOW = 20;
const FILE = path.join(process.cwd(), "data", "accept_memory.json");
const NAMES_FILE = path.join(process.cwd(), "data", "accept_names.json");
const PARALLEL = 5; // عدد طلبات الأسماء المتزامنة

let memory = {}; // threadID -> { userID: { at, reason, ignored } }
try { memory = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) { memory = {}; }
const save = () => {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(memory));
    } catch (e) { /* لا شيء */ }
};
const busy = {};

const wait = ms => new Promise(r => setTimeout(r, ms));
const pause = () => wait(global.__acceptPauseMs != null ? global.__acceptPauseMs : 700 + Math.floor(Math.random() * 600));
const clean = s => String(s).replace(/[<>]/g, "").replace(/[\uD800-\uDFFF\u0000-\u0008\u000B-\u001F]/g, "").slice(0, 3000);

// يدعم المكتبات التي تعمل بـ callback أو Promise
function call(fn) {
    return new Promise((resolve, reject) => {
        let done = false;
        const cb = (err, data) => { if (done) return; done = true; err ? reject(err) : resolve(data); };
        let r;
        try { r = fn(cb); } catch (e) { return cb(e); }
        if (r && typeof r.then === "function") r.then(d => cb(null, d), e => cb(e || new Error("فشل")));
    });
}

function reasonOf(e) {
    let text;
    if (!e) text = "غير معروف";
    else if (typeof e === "string") text = e;
    else {
        const parts = [e.errorSummary, e.errorDescription, e.error, e.message]
            .filter(v => (typeof v === "string" && v.trim()) || typeof v === "number").map(String);
        text = [...new Set(parts)].slice(0, 2).join(" - ") || "غير معروف";
    }
    // خلل في المكتبة يخفي رد فيسبوك الحقيقي: فيسبوك رفض الإضافة
    if (/CustomError is not a constructor/i.test(text)) return "رفض فيسبوك إضافته";
    return text.slice(0, 120);
}

// ---------------- الأسماء ----------------
const UNKNOWN = /^(مستخدم|مستخدم فيسبوك|facebook user|user)$/i;
const HOUR = 60 * 60 * 1000;
let nameCache = {}; // id -> الاسم (محفوظ على القرص فلا يُجلب مرتين)
try { nameCache = JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")) || {}; } catch (e) { nameCache = {}; }
const saveNames = () => {
    try {
        const keys = Object.keys(nameCache);
        if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete nameCache[k]);
        fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
        fs.writeFileSync(NAMES_FILE, JSON.stringify(nameCache));
    } catch (e) { /* لا شيء */ }
};
const unknownAt = {}; // id -> وقت آخر فشل في معرفة الاسم

const goodName = n => {
    const s = n == null ? "" : String(n).trim();
    return s && !UNKNOWN.test(s) ? s : "";
};

// اسم حساب واحد من فيسبوك (المكتبة ترجع اسم أول حساب فقط إن طلبنا عدة حسابات معًا)
async function fetchName(api, id) {
    try {
        const info = await Promise.race([
            call(cb => api.getUserInfo(id, cb)),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7000))
        ]);
        const keys = info ? Object.keys(info) : [];
        const u = info && (info[id] || (keys.length === 1 ? info[keys[0]] : null));
        const n = u && goodName(u.name || u.alternateName || u.firstName);
        if (!n) console.log("[ACCEPT] لا يوجد اسم للحساب", id, JSON.stringify(info || {}).slice(0, 160));
        return n || "";
    } catch (e) {
        return "";
    }
}

// يرجع كائنًا فيه الأسماء المعروفة فقط. يجلب الأسماء الناقصة 5 في وقت واحد
async function namesOf(api, Users, ids) {
    const out = {};
    const todo = [];
    for (const id of ids) {
        if (nameCache[id]) out[id] = nameCache[id];
        else if (Date.now() - (unknownAt[id] || 0) >= HOUR) todo.push(id);
    }
    let next = 0, fresh = false;
    const worker = async () => {
        while (next < todo.length) {
            const id = todo[next++];
            let n = "";
            try {
                n = goodName(global.data && global.data.userName && global.data.userName.get && global.data.userName.get(id));
                if (!n) n = await fetchName(api, id);
                if (!n && Users && typeof Users.getNameUser === "function") n = goodName(await Users.getNameUser(id));
            } catch (e) { /* نتابع */ }
            if (n) { out[id] = nameCache[id] = n; fresh = true; }
            else unknownAt[id] = Date.now();
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    if (fresh) saveNames();
    return out;
}
const labelOf = (names, id) => names[id] || "❔ اسم غير متاح";

// إرسال آمن يرجع معلومات الرسالة، ولا يرمي أي خطأ
function makeSend(api, threadID, replyTo) {
    const once = text => new Promise(resolve => {
        let done = false;
        const fin = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
        const timer = setTimeout(() => fin(null), 15000);
        try {
            const r = api.sendMessage(text, threadID, (err, info) => fin(err ? null : (info || {})), replyTo);
            if (r && typeof r.then === "function") r.then(i => fin(i || {}), () => fin(null));
        } catch (e) {
            console.error("[ACCEPT] فشل إرسال الرد:", e && e.message);
            fin(null);
        }
    });
    return async t => {
        const text = H + clean(t);
        let r = await once(text);
        // إن فشل الإرسال نعيد المحاولة بدون روابط
        if (!r && /facebook\.com\//.test(text)) r = await once(text.replace(/facebook\.com\//g, "ID: "));
        return r;
    };
}

function register(info, extra) {
    if (!info || !info.messageID) return;
    global.client = global.client || {};
    global.client.handleReply = global.client.handleReply || [];
    global.client.handleReply.push(Object.assign({ name: module.exports.config.name, messageID: info.messageID }, extra));
}
function unregister(messageID) {
    const list = global.client && global.client.handleReply;
    if (!Array.isArray(list)) return;
    const i = list.findIndex(e => e.name === module.exports.config.name && e.messageID == messageID);
    if (i >= 0) list.splice(i, 1);
}

// ---------------- فهم نص المستخدم ----------------
function normalize(s) {
    return String(s || "")
        .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
        .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
        .trim();
}

function parse(text) {
    const t = normalize(text);
    if (!t) return { type: "list" };
    if (/^(إلغاء|الغاء|cancel|خروج)$/i.test(t)) return { type: "cancel" };
    if (/^(استعادة|استرجاع|restore)$/i.test(t)) return { type: "restore" };

    let type = "accept";
    let rest = t;
    const m = t.match(/^(رفض|تجاهل|reject|ignore)\s*(.*)$/i);
    if (m) { type = "ignore"; rest = m[2].trim(); }

    const all = rest.match(/^(الكل|all|\*)\s*(إعادة|اعادة|retry)?$/i);
    if (all) return { type, all: true, retry: !!all[2] };

    const nums = [];
    for (const tok of rest.split(/[\s,،]+/).filter(Boolean)) {
        let r;
        if (/^\d+$/.test(tok)) nums.push(parseInt(tok));
        else if ((r = tok.match(/^(\d+)[-–](\d+)$/)) && parseInt(r[2]) - parseInt(r[1]) < 50) {
            for (let i = parseInt(r[1]); i <= parseInt(r[2]); i++) nums.push(i);
        } else return { type: "invalid" };
    }
    if (!nums.length) return { type: "invalid" };
    return { type, nums: [...new Set(nums)] };
}

const HELP =
    "↩️ رد على هذه الرسالة بـ:\n" +
    "• رقم أو عدة أرقام للقبول: 2  أو  1 3 5  أو  1-4\n" +
    "• الكل : قبول الجميع (حتى 15 في المرة)\n" +
    "• رفض 2 : تجاهل الطلب (يخفيه عن البوت فقط)\n" +
    "• رفض الكل : تجاهل الجميع\n" +
    "• استعادة : إرجاع المتجاهلين والفاشلين\n" +
    "• إلغاء : إغلاق القائمة";

// ترتيب: الجديدة أولًا، ثم التي فشلت، ثم المتجاهلة (والترتيب الأصلي محفوظ داخل كل قسم)
function order(queue, mem) {
    const rank = id => !mem[id] ? 0 : mem[id].ignored ? 2 : 1;
    return queue.map((id, i) => ({ id, i, r: rank(id) }))
        .sort((x, y) => x.r - y.r || x.i - y.i).map(x => x.id);
}

function renderList(queue, names, mem, note) {
    let text = note ? note + "\n\n" : "";
    text += "▣ الطلبات المعلقة (" + queue.length + ")\n";
    const shown = queue.slice(0, SHOW);
    const sections = [
        ["✨ جديدة (لم تُجرَّب)", id => !mem[id]],
        ["⚠️ فشلت سابقًا", id => mem[id] && !mem[id].ignored],
        ["⛔ متجاهلة", id => mem[id] && mem[id].ignored]
    ];
    sections.forEach(([title, test]) => {
        const rows = shown.map((id, i) => ({ id, n: i + 1 })).filter(x => test(x.id));
        if (!rows.length) return;
        text += "\n" + title + " — " + rows.length + "\n";
        rows.forEach(({ id, n }) => {
            text += n + ". " + labelOf(names, id) + " · " + (names[id] ? id : "facebook.com/" + id);
            if (mem[id] && !mem[id].ignored && mem[id].reason !== "رفض فيسبوك إضافته") text += " (" + mem[id].reason + ")";
            text += "\n";
        });
    });
    if (queue.length > SHOW) text += "\n... و " + (queue.length - SHOW) + " طلب آخر (تظهر بعد معالجة هذه)\n";
    return text + "\n" + HELP;
}

// ---------------- التنفيذ (مشترك بين الأمر والرد) ----------------
async function execute({ api, event, text, entry, Users }) {
    const threadID = String(event.threadID);
    const send = makeSend(api, threadID, event.messageID);

    if (busy[threadID]) { await send("⏳ جاري تنفيذ طلب سابق، انتظر قليلًا."); return; }
    busy[threadID] = true;
    try {
        const info = await call(cb => api.getThreadInfo(threadID, cb));
        const idOf = a => String(a && a.id ? a.id : a);
        const admins = (info.adminIDs || []).map(idOf);
        if (!admins.includes(String(event.senderID))) { await send("⛔ هذا الأمر للأدمن فقط!"); return; }
        if (!admins.includes(String(api.getCurrentUserID()))) { await send("⚠️ يجب أن يكون البوت أدمن في المجموعة."); return; }

        let queue = (info.approvalQueue || [])
            .map(r => String(r.requesterID || r.id || r.userID || "")).filter(Boolean);
        const mem = (memory[threadID] = memory[threadID] || {});
        queue = order(queue, mem);
        const blocked = id => mem[id] && (mem[id].ignored || Date.now() - mem[id].at < RETRY_AFTER);
        const cmd = parse(text);

        if (cmd.type === "cancel") {
            if (entry) unregister(entry.messageID);
            await send("تم إغلاق القائمة.");
            return;
        }
        if (cmd.type === "invalid") {
            await send("لم أفهم ردك.\n\n" + HELP);
            return;
        }

        let note = "";
        const shown = entry && entry.ids ? entry.ids : queue.slice(0, SHOW);
        const pick = nums => nums.map(n => shown[n - 1]).filter(Boolean);

        if (cmd.type === "restore") {
            memory[threadID] = {};
            save();
            Object.keys(mem).forEach(k => delete mem[k]);
            note = "♻️ تمت استعادة كل الطلبات المتجاهلة والفاشلة.";
        } else if (cmd.type === "ignore" && queue.length) {
            const targets = cmd.all ? queue : pick(cmd.nums);
            targets.forEach(id => { mem[id] = { at: Date.now(), reason: "متجاهل", ignored: true }; });
            save();
            note = targets.length
                ? "⛔ تم تجاهل " + targets.length + " طلب في قائمة البوت فقط.\nيبقى الطلب عند فيسبوك، ولرفضه فعليًا افتح ماسنجر ← إعدادات المجموعة ← طلبات الانضمام."
                : "⚠️ لا توجد أرقام صحيحة في ردك.";
        } else if (cmd.type === "accept" && queue.length) {
            const targets = cmd.all ? queue.filter(id => cmd.retry || !blocked(id)) : pick(cmd.nums);
            const skipped = cmd.all ? queue.length - targets.length : 0;
            const todo = targets.slice(0, MAX_PER_RUN);
            if (!todo.length) {
                note = cmd.all
                    ? "لا يوجد جديد لتجربته. تخطيت " + skipped + " طلب فشل قبله أو تم تجاهله.\nلإعادة تجربتهم رد بـ: الكل إعادة"
                    : "⚠️ لا توجد أرقام صحيحة في ردك.";
            } else {
                const namesP = namesOf(api, Users, todo); // يعمل بالتوازي مع القبول
                const accepted = [];
                const failed = [];
                for (const id of todo) {
                    try {
                        await call(cb => api.addUserToGroup(id, threadID, cb));
                        delete mem[id];
                        accepted.push(id);
                    } catch (e) {
                        const reason = reasonOf(e);
                        mem[id] = { at: Date.now(), reason };
                        failed.push({ id, reason });
                        console.error("[ACCEPT] فشل قبول", id, reason);
                    }
                    if (todo.length > 1) await pause();
                }
                save();
                const names = await namesP;
                queue = queue.filter(id => !accepted.includes(id));
                note = "✅ تم قبول " + accepted.length + " طلب" +
                    (accepted.length ? ":\n" + accepted.map(id => "• " + labelOf(names, id)).join("\n") : ".");
                // الفاشلون مجمّعون حسب السبب بدل تكرار السبب مع كل واحد
                const groups = {};
                failed.forEach(f => { (groups[f.reason] = groups[f.reason] || []).push(f.id); });
                Object.keys(groups).forEach(reason => {
                    note += "\n\n❌ تعذر قبول " + groups[reason].length + " (" + reason + "):";
                    groups[reason].forEach(id => { note += "\n• " + labelOf(names, id) + " — " + (names[id] ? id : "facebook.com/" + id); });
                });
                if (skipped) note += "\n\n(تخطيت " + skipped + " طلب فشل قبله أو تم تجاهله)";
                if (targets.length > todo.length) note += "\nتبقى طلبات، رد مرة أخرى لقبول المزيد.";
            }
        }

        if (entry) unregister(entry.messageID);
        if (!queue.length) { await send((note ? note + "\n\n" : "") + "📭 لا توجد طلبات انضمام معلقة."); return; }

        queue = order(queue, mem);
        const showNow = queue.slice(0, SHOW);
        const names = await namesOf(api, Users, showNow);
        const sent = await send(renderList(queue, names, mem, note));
        register(sent, { author: String(event.senderID), threadID, ids: showNow });
    } catch (error) {
        console.error("[ACCEPT ERROR]", error && (error.message || error));
        await send("❌ حدث خطأ: " + reasonOf(error));
    } finally {
        busy[threadID] = false;
    }
}

module.exports.run = async function ({ api, event, args, Users }) {
    return execute({ api, event, text: (args || []).join(" "), Users });
};

module.exports.handleReply = async function ({ api, event, handleReply, Users }) {
    if (!event.body) return;
    if (String(event.threadID) !== String(handleReply.threadID)) return;
    return execute({ api, event, text: event.body, entry: handleReply, Users });
};