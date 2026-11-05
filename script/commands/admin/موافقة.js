const axios = require("axios");

module.exports.config = {
    name: "موافقة",
    version: "3.0.0",
    hasPermssion: 1,
    credits: "أبو هريرة",
    description: "التحكم في موافقة الأدمن على إضافة الأعضاء",
    commandCategory: "Admin",
    usages: "موافقة | موافقة تشغيل | موافقة إيقاف",
    cooldowns: 8
};

const HEADER = "⌬ ━━ 𝗛𝗜𝗡𝗔  ━━ ⌬\n\n";
const URL = "https://www.facebook.com/messaging/set_approval_mode/?dpr=1";
const isOn = v => v === true || v === 1 || v === "1";
const wait = ms => new Promise(r => setTimeout(r, ms));
const msg = e => (typeof e === "string" ? e : (e && (e.error || e.message)) || "خطأ غير معروف");
// ينظّف النص قبل إرساله (يحذف الرموز الغريبة و < > ويقصّه)
const clean = s => String(s).replace(/[<>]/g, "").replace(/[\uD800-\uDFFF\u0000-\u0008\u000B-\u001F]/g, "").slice(0, 700);

// يدعم المكتبات التي تعمل بـ callback أو Promise
function call(fn) {
    return new Promise((resolve, reject) => {
        let done = false;
        const cb = (err, data) => {
            if (done) return;
            done = true;
            err ? reject(new Error(msg(err))) : resolve(data);
        };
        let r;
        try { r = fn(cb); } catch (e) { return cb(e); }
        if (r && typeof r.then === "function") r.then(d => cb(null, d), e => cb(e));
    });
}

function check(raw) {
    const text = String(raw || "").replace(/^for\s*\(;;\);/, "").trim();
    if (!text || text[0] === "<") throw new Error("رد غير صالح. النوع: " + typeof raw + " | الطول: " + text.length + " | البداية: " + text.slice(0, 150).replace(/\s+/g, " "));
    const data = JSON.parse(text);
    if (!data.error) return true;
    const code = Number(data.error);
    if (code === 1357031) throw new Error("حساب البوت ليس أدمن في هذه المجموعة.");
    throw new Error("رفض فيسبوك الطلب. الكود: " + code);
}

async function direct(api, threadID, mode) {
    const state = api.getAppState();
    const cookie = state.filter(c => c && c.key).map(c => c.key + "=" + c.value).join("; ");
    const user = (state.find(c => c.key === "c_user") || {}).value;
    const headers = {
        Cookie: cookie,
        "User-Agent": process.env.FB_USER_AGENT ||
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    };
    const page = await axios.get("https://www.facebook.com/", { timeout: 20000, headers, validateStatus: () => true });
    if (page.status >= 400) throw new Error("فتح فيسبوك رجع HTTP " + page.status + " | " + String(page.data).slice(0, 150).replace(/\s+/g, " "));
    const html = String(page.data || "");
    const dtsg = (html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) || [])[1] ||
        (html.match(/name="fb_dtsg"\s+value="([^"]+)"/) || [])[1];
    if (!dtsg || !user) throw new Error("تعذر قراءة الجلسة (fb_dtsg).");
    let jazoest = "2";
    for (const ch of dtsg) jazoest += ch.charCodeAt(0);
    const rev = (html.match(/"client_revision":(\d+)/) || [])[1] || "";
    const form = new URLSearchParams({
        thread_fbid: String(threadID), set_mode: String(mode),
        __user: user, __a: "1", __req: "1", fb_dtsg: dtsg, jazoest
    });
    if (rev) form.append("__rev", rev);
    const res = await axios.post(URL, form.toString(), {
        timeout: 20000, responseType: "text", transformResponse: [d => d],
        validateStatus: () => true,
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://www.facebook.com", Referer: "https://www.facebook.com/" }
    });
    if (res.status >= 400) throw new Error("رفض فيسبوك الطلب (HTTP " + res.status + ").");
    return check(res.data);
}

async function setMode(api, threadID, enabled) {
    const mode = enabled ? 1 : 0;
    const tries = [];
    if (typeof api.changeApprovalMode === "function")
        tries.push(["changeApprovalMode", () => call(cb => api.changeApprovalMode(mode, String(threadID), cb))]);
    if (typeof api.httpPost === "function")
        tries.push(["httpPost", async () => check(await call(cb => api.httpPost(URL, { thread_fbid: String(threadID), set_mode: mode }, cb)))]);
    if (typeof api.getAppState === "function")
        tries.push(["direct", () => direct(api, threadID, mode)]);

    const errors = [];
    for (const [name, run] of tries) {
        try {
            await run();
            console.log("[APPROVAL] نجحت الطريقة:", name);
            return name;
        } catch (e) {
            console.error("[APPROVAL] فشلت " + name + ":", e.message);
            errors.push(name + ": " + e.message);
            if (/ليس أدمن/.test(e.message)) throw e;
        }
    }
    throw new Error("فشلت كل الطرق:\n" + errors.join("\n"));
}

module.exports.run = async function ({ api, event, args }) {
    const threadID = String(event.threadID || "");
    if (!threadID) return;

    // إرسال آمن: لا يرمي أي خطأ أبدًا
    const reply = async t => {
        try {
            return await api.sendMessage(HEADER + clean(t), threadID, event.messageID);
        } catch (e) {
            console.error("[APPROVAL] فشل إرسال الرد:", e && e.message);
            try { return await api.sendMessage("تعذر تنفيذ الأمر. راجع سجلات Railway (APPROVAL).", threadID); } catch (e2) { /* لا شيء */ }
        }
    };

    try {
        const parts = Array.isArray(args) ? args : String(event.body || "").trim().split(/\s+/).slice(1);
        const action = String(parts[0] || "").toLowerCase();

        const info = await call(cb => api.getThreadInfo(threadID, cb));
        const enabled = isOn(info && info.approvalMode);

        if (!action)
            return reply("حالة موافقة الأدمن\n\nالحالة: " + (enabled ? "مفعلة ✅" : "متوقفة ❌") +
                "\n\nللتغيير:\n.موافقة تشغيل\n.موافقة إيقاف");

        const on = ["تشغيل", "تفعيل", "on", "enable"].includes(action);
        const off = ["إيقاف", "ايقاف", "إلغاء", "الغاء", "off", "disable"].includes(action);
        if (!on && !off) return reply("الاستخدام:\n.موافقة\n.موافقة تشغيل\n.موافقة إيقاف");
        if (on && enabled) return reply("الموافقة مفعلة بالفعل.");
        if (off && !enabled) return reply("الموافقة متوقفة بالفعل.");

        const botID = String(api.getCurrentUserID());
        const admins = ((info && info.adminIDs) || []).map(a => String(a && a.id ? a.id : a));
        if (!admins.includes(botID))
            return reply("حساب البوت ليس أدمن في هذه المجموعة. اجعله أدمن ثم أعد المحاولة.");

        const method = await setMode(api, threadID, on);

        let confirmed = false;
        for (let i = 0; i < 2 && !confirmed; i++) {
            await wait(2500);
            try {
                const now = await call(cb => api.getThreadInfo(threadID, cb));
                confirmed = isOn(now && now.approvalMode) === on;
            } catch (e) { /* نتجاهل ونعيد */ }
        }
        if (!confirmed)
            return reply("قبل فيسبوك الطلب لكن الحالة لم تتغير بعد في القراءة.\n" +
                "أرسل .موافقة بعد دقيقة للتأكد. (الطريقة: " + method + ")");

        return reply(on ? "تم تفعيل موافقة الأدمن ✅" : "تم إيقاف موافقة الأدمن ✅");
    } catch (error) {
        console.error("[APPROVAL ERROR]", error && error.message);
        return reply("تعذر تغيير الموافقة.\n\n" + msg(error));
    }
};