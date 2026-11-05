module.exports.config = {
    name: "موافقة",
    version: "4.0.0",
    hasPermssion: 1,
    credits: "أبو هريرة",
    description: "عرض حالة موافقة الأدمن على إضافة الأعضاء",
    commandCategory: "Admin",
    usages: "موافقة",
    cooldowns: 5
};

const HEADER = "⌬ ━━ 𝗛𝗜𝗡𝗔  ━━ ⌬\n\n";

function getInfo(api, threadID) {
    return new Promise((resolve, reject) => {
        let done = false;
        const cb = (err, info) => {
            if (done) return;
            done = true;
            err ? reject(err) : resolve(info);
        };
        let r;
        try { r = api.getThreadInfo(threadID, cb); } catch (e) { return cb(e); }
        if (r && typeof r.then === "function") r.then(i => cb(null, i), e => cb(e));
    });
}

module.exports.run = async function ({ api, event }) {
    const threadID = String(event.threadID || "");
    const send = async t => {
        try { await api.sendMessage(HEADER + t, threadID, event.messageID); }
        catch (e) { console.error("[APPROVAL] فشل الإرسال"); }
    };
    try {
        const info = await getInfo(api, threadID);
        const on = info && (info.approvalMode === true || info.approvalMode === 1 || info.approvalMode === "1");
        const queue = (info && info.approvalQueue) || [];
        await send(
            "حالة موافقة الأدمن: " + (on ? "مفعلة ✅" : "متوقفة ❌") + "\n" +
            "عدد الطلبات المعلقة: " + queue.length + "\n\n" +
            "لتغيير الحالة (يدويًا من ماسنجر):\n" +
            "إعدادات المجموعة ← الأعضاء ← الموافقة على الأعضاء الجدد.\n\n" +
            "لقبول الطلبات المعلقة استخدم: .قبول"
        );
    } catch (error) {
        console.error("[APPROVAL ERROR]", error && error.message);
        await send("تعذر قراءة حالة الموافقة.");
    }
};