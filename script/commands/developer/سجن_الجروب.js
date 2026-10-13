/**
 * سجن_الجروب.js
 * Version: 5.0.0
 *
 * - تغيير اسم المجموعة
 * - تغيير صورة المجموعة
 * - تغيير كنيات الأعضاء إلى نقطة
 * - تخطي الكنيات المطابقة
 * - إعادة المحاولة عند فشل تغيير الكنية
 * - تسريع تغيير الكنيات بالتوازي
 * - عرض النتائج في مجموعة تنفيذ الأمر فقط
 * - للمطورين المصرح لهم فقط
 */

const https = require("https");
const http = require("http");
const { Readable } = require("stream");

// ==================== الإعدادات ====================

const GROUP_NAME = "شلة السجن قاهرتكم ⛓️🔒";
const NICKNAME = ".";
const GROUP_IMAGE_URL = "https://files.catbox.moe/qlj88e.jpg";

const MAX_RETRIES = 3;
const MEMBER_CONCURRENCY = 5;
const RETRY_DELAY = 300;
const API_TIMEOUT = 20000;
const IMAGE_TIMEOUT = 20000;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

// ==================== أدوات مساعدة ====================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function logError(label, error) {
    console.error(
        `[سجن_الجروب] ${label}:`,
        error?.message || error || "خطأ غير معروف"
    );
}

function normalizeIDs(value) {
    if (value == null) return [];

    const values = Array.isArray(value) ? value : [value];

    return values
        .flatMap(item => {
            if (item == null) return [];

            if (typeof item === "object") {
                return [
                    item.id,
                    item.userID,
                    item.threadID,
                    item.uid
                ].filter(Boolean);
            }

            return [item];
        })
        .map(String)
        .filter(Boolean);
}

function getDeveloperIDs() {
    const ids = [
        ...normalizeIDs(global.config?.ADMINBOT),
        ...normalizeIDs(global.KIRA_CONF?.dev)
    ];

    return [...new Set(ids)];
}

function isDeveloper(senderID) {
    return getDeveloperIDs().includes(String(senderID));
}

/**
 * استدعاء دوال API التي تستخدم callback أو Promise.
 */
function callAPI(api, methodName, args = [], timeout = API_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const method = api?.[methodName];

        if (typeof method !== "function") {
            return reject(
                new Error(`الدالة ${methodName} غير موجودة في API`)
            );
        }

        let settled = false;

        const timer = setTimeout(() => {
            finish(
                new Error(`انتهت مهلة الدالة ${methodName}`)
            );
        }, timeout);

        function finish(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (error) reject(error);
            else resolve(result);
        }

        const callback = (error, result) => {
            if (error) return finish(error);
            finish(null, result);
        };

        try {
            const result = method.call(api, ...args, callback);

            if (result && typeof result.then === "function") {
                result.then(
                    value => finish(null, value),
                    error => finish(error)
                );
            } else if (
                result !== undefined &&
                method.length <= args.length
            ) {
                finish(null, result);
            }
        } catch (error) {
            finish(error);
        }
    });
}

async function sendToControl(api, threadID, message) {
    try {
        await callAPI(
            api,
            "sendMessage",
            [String(message), String(threadID)],
            15000
        );
    } catch (error) {
        logError("تعذر إرسال التقرير إلى مجموعة التنفيذ", error);
    }
}

// ==================== جلب المجموعات ====================

function collectThreadIDs(Threads) {
    const ids = new Set();

    function add(source) {
        if (!source) return;

        if (source instanceof Map) {
            for (const [key, value] of source.entries()) {
                ids.add(String(key));

                if (value?.threadID) {
                    ids.add(String(value.threadID));
                }
            }
            return;
        }

        if (Array.isArray(source)) {
            for (const item of source) {
                if (item == null) continue;

                if (typeof item === "object") {
                    const id = item.threadID || item.id;
                    if (id) ids.add(String(id));
                } else {
                    ids.add(String(item));
                }
            }
            return;
        }

        if (typeof source === "object") {
            for (const [key, value] of Object.entries(source)) {
                ids.add(String(key));

                if (value?.threadID) {
                    ids.add(String(value.threadID));
                }
            }
        }
    }

    add(global.data?.allThreadID);
    add(global.data?.threadData);
    add(Threads?.database);

    return [...ids].filter(Boolean);
}

async function getThreadInfo(api, threadID) {
    return callAPI(
        api,
        "getThreadInfo",
        [String(threadID)],
        12000
    );
}

function isGroupInfo(info) {
    if (!info || typeof info !== "object") return false;

    if (info.isGroup === true) return true;

    if (
        typeof info.threadType === "string" &&
        info.threadType.toUpperCase().includes("GROUP")
    ) {
        return true;
    }

    const members = info.participantIDs || info.participants;

    return Array.isArray(members) && members.length > 2;
}

function getGroupName(info, fallback = "") {
    return (
        info?.threadName ||
        info?.name ||
        fallback ||
        "مجموعة بلا اسم"
    );
}

async function fetchThreadList(api) {
    if (typeof api?.getThreadList !== "function") {
        return [];
    }

    const attempts = [
        [100, null, ["INBOX"]],
        [100, null, []]
    ];

    for (const args of attempts) {
        try {
            const list = await callAPI(
                api,
                "getThreadList",
                args,
                15000
            );

            if (Array.isArray(list)) return list;
        } catch (error) {
            logError("تعذر جلب قائمة المحادثات", error);
        }
    }

    return [];
}

async function fetchAllGroups(api, Threads, controlThreadID) {
    const candidates = new Map();

    for (const id of collectThreadIDs(Threads)) {
        candidates.set(String(id), {
            threadID: String(id),
            threadName: ""
        });
    }

    const threadList = await fetchThreadList(api);

    for (const item of threadList) {
        const id = item?.threadID || item?.id;

        if (!id) continue;

        const key = String(id);

        if (!candidates.has(key)) {
            candidates.set(key, {
                threadID: key,
                threadName: item.threadName || item.name || ""
            });
        }
    }

    const all = [...candidates.values()];
    const groups = [];
    let checked = 0;

    await runLimited(all, 8, async item => {
        if (String(item.threadID) === String(controlThreadID)) {
            return;
        }

        try {
            const info = await getThreadInfo(api, item.threadID);

            if (!isGroupInfo(info)) return;

            groups.push({
                threadID: String(item.threadID),
                threadName: getGroupName(info, item.threadName),
                memberCount: (
                    info.participantIDs ||
                    info.participants ||
                    []
                ).length
            });
        } catch (error) {
            checked++;
            logError(
                `تعذر التحقق من المجموعة ${item.threadID}`,
                error
            );
        }
    });

    groups.sort((a, b) =>
        a.threadName.localeCompare(b.threadName, "ar")
    );

    return {
        groups,
        totalCandidates: all.length,
        failedChecks: checked
    };
}

// ==================== تشغيل مهام بالتوازي ====================

async function runLimited(items, limit, worker) {
    let index = 0;

    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            while (true) {
                const current = index++;

                if (current >= items.length) break;

                try {
                    await worker(items[current], current);
                } catch (error) {
                    logError("فشلت مهمة متوازية", error);
                }
            }
        }
    );

    await Promise.all(workers);
}

// ==================== تغيير اسم المجموعة ====================

async function setGroupTitle(api, threadID) {
    await callAPI(
        api,
        "setTitle",
        [GROUP_NAME, String(threadID)],
        API_TIMEOUT
    );

    return true;
}

// ==================== تحميل صورة المجموعة ====================

function downloadImage(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) {
            return reject(new Error("عدد تحويلات رابط الصورة كبير"));
        }

        let parsed;

        try {
            parsed = new URL(url);
        } catch {
            return reject(new Error("رابط الصورة غير صحيح"));
        }

        if (!["https:", "http:"].includes(parsed.protocol)) {
            return reject(new Error("نوع رابط الصورة غير مدعوم"));
        }

        const requester = parsed.protocol === "https:" ? https : http;

        const request = requester.get(
            parsed,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0"
                },
                timeout: IMAGE_TIMEOUT
            },
            response => {
                const status = response.statusCode || 0;

                if (
                    status >= 300 &&
                    status < 400 &&
                    response.headers.location
                ) {
                    response.resume();

                    const nextURL = new URL(
                        response.headers.location,
                        parsed
                    ).toString();

                    return resolve(
                        downloadImage(nextURL, redirects + 1)
                    );
                }

                if (status !== 200) {
                    response.resume();

                    return reject(
                        new Error(`فشل تحميل الصورة: HTTP ${status}`)
                    );
                }

                const contentType = String(
                    response.headers["content-type"] || ""
                );

                if (!contentType.startsWith("image/")) {
                    response.resume();

                    return reject(
                        new Error("الرابط لا يعيد ملف صورة")
                    );
                }

                const chunks = [];
                let total = 0;

                response.on("data", chunk => {
                    total += chunk.length;

                    if (total > MAX_IMAGE_SIZE) {
                        request.destroy(
                            new Error("حجم الصورة أكبر من الحد المسموح")
                        );
                        return;
                    }

                    chunks.push(chunk);
                });

                response.on("end", () => {
                    if (!total) {
                        return reject(new Error("ملف الصورة فارغ"));
                    }

                    resolve({
                        buffer: Buffer.concat(chunks),
                        contentType
                    });
                });

                response.on("error", reject);
            }
        );

        request.on("timeout", () => {
            request.destroy(new Error("انتهت مهلة تحميل الصورة"));
        });

        request.on("error", reject);
    });
}

async function changeGroupImage(api, threadID, imageBuffer) {
    const imageStream = Readable.from([imageBuffer]);

    // مكتبة FCA الشائعة تستخدم changeGroupImage(image, threadID, callback).
    if (typeof api?.changeGroupImage === "function") {
        await callAPI(
            api,
            "changeGroupImage",
            [imageStream, String(threadID)],
            API_TIMEOUT
        );

        return true;
    }

    // بعض المكتبات تستخدم اسمًا مختلفًا للدالة.
    if (typeof api?.changeThreadImage === "function") {
        await callAPI(
            api,
            "changeThreadImage",
            [imageStream, String(threadID)],
            API_TIMEOUT
        );

        return true;
    }

    throw new Error(
        "مكتبة البوت لا توفر changeGroupImage أو changeThreadImage"
    );
}

// ==================== معلومات الأعضاء والكنيات ====================

function getMemberIDs(info) {
    const members =
        info?.participantIDs ||
        info?.participants ||
        [];

    return [...new Set(
        members
            .map(member => {
                if (typeof member === "object") {
                    return member.userID || member.id || member.uid;
                }

                return member;
            })
            .filter(Boolean)
            .map(String)
    )];
}

function getNickname(info, userID) {
    const nicknames = info?.nicknames;

    if (!nicknames) return "";

    if (Array.isArray(nicknames)) {
        const entry = nicknames.find(item =>
            String(item?.userID || item?.id) === String(userID)
        );

        return entry?.nickname || entry?.name || "";
    }

    const entry = nicknames[String(userID)];

    if (typeof entry === "string") return entry;

    return entry?.nickname || entry?.name || "";
}

async function setNickname(api, threadID, userID) {
    await callAPI(
        api,
        "changeNickname",
        [NICKNAME, String(threadID), String(userID)],
        API_TIMEOUT
    );
}

// ==================== معالجة مجموعة واحدة ====================

async function processGroup(api, group) {
    const threadID = String(group.threadID);

    const report = {
        threadID,
        threadName: group.threadName,
        titleChanged: false,
        titleFailed: false,
        imageChanged: false,
        imageFailed: false,
        nicknameSuccess: 0,
        nicknameSkipped: 0,
        nicknameFailed: 0,
        memberCount: 0,
        errors: []
    };

    // تغيير الاسم
    try {
        await setGroupTitle(api, threadID);
        report.titleChanged = true;
    } catch (error) {
        report.titleFailed = true;
        report.errors.push("فشل تغيير اسم المجموعة");
        logError(`تغيير اسم المجموعة ${threadID}`, error);
    }

    // تغيير الصورة إلى الصورة الجديدة
    try {
        const image = await downloadImage(GROUP_IMAGE_URL);

        await changeGroupImage(api, threadID, image.buffer);

        report.imageChanged = true;
    } catch (error) {
        report.imageFailed = true;
        report.errors.push("فشل تغيير صورة المجموعة");
        logError(`تغيير صورة المجموعة ${threadID}`, error);
    }

    // جلب الأعضاء والكنيات الحالية
    let info;

    try {
        info = await getThreadInfo(api, threadID);
    } catch (error) {
        report.errors.push("تعذر جلب معلومات الأعضاء");
        logError(`معلومات المجموعة ${threadID}`, error);
        return report;
    }

    const members = getMemberIDs(info);
    report.memberCount = members.length;

    const pendingInitial = [];

    for (const userID of members) {
        if (getNickname(info, userID) === NICKNAME) {
            report.nicknameSkipped++;
        } else {
            pendingInitial.push(userID);
        }
    }

    let pending = pendingInitial;

    // تغيير الكنيات بالتوازي مع إعادة المحاولة
    for (
        let attempt = 1;
        attempt <= MAX_RETRIES && pending.length > 0;
        attempt++
    ) {
        const failedThisRound = [];

        await runLimited(
            pending,
            MEMBER_CONCURRENCY,
            async userID => {
                try {
                    await setNickname(api, threadID, userID);
                    report.nicknameSuccess++;
                } catch (error) {
                    failedThisRound.push(userID);

                    logError(
                        `تغيير كنية ${userID} في ${threadID} ` +
                        `(المحاولة ${attempt}/${MAX_RETRIES})`,
                        error
                    );
                }
            }
        );

        pending = failedThisRound;

        if (pending.length > 0 && attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY);
        }
    }

    report.nicknameFailed = pending.length;

    return report;
}

// ==================== عرض النتائج ====================

function formatReport(reports) {
    let totalMembers = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;
    let titleSuccess = 0;
    let titleFailed = 0;
    let imageSuccess = 0;
    let imageFailed = 0;

    for (const report of reports) {
        totalMembers += report.memberCount;
        success += report.nicknameSuccess;
        skipped += report.nicknameSkipped;
        failed += report.nicknameFailed;

        if (report.titleChanged) titleSuccess++;
        if (report.titleFailed) titleFailed++;
        if (report.imageChanged) imageSuccess++;
        if (report.imageFailed) imageFailed++;
    }

    const lines = [
        "⛓️ تقرير سجن المجموعات",
        "━━━━━━━━━━━━━━━━━━",
        `المجموعات المعالجة: ${reports.length}`,
        `تغيير أسماء المجموعات بنجاح: ${titleSuccess}`,
        `فشل تغيير الأسماء: ${titleFailed}`,
        `تغيير صور المجموعات بنجاح: ${imageSuccess}`,
        `فشل تغيير الصور: ${imageFailed}`,
        `إجمالي الأعضاء: ${totalMembers}`,
        `الكنيات التي تغيرت بنجاح: ${success}`,
        `الكنيات التي تم تخطيها: ${skipped}`,
        `الكنيات التي فشل تغييرها بعد المحاولات: ${failed}`,
        "━━━━━━━━━━━━━━━━━━",
        "تفاصيل المجموعات:"
    ];

    for (const report of reports) {
        lines.push(
            `\n• ${report.threadName}`,
            `الاسم: ${report.titleChanged ? "تم" : "فشل أو لم يتغير"}`,
            `الصورة: ${report.imageChanged ? "تم" : "فشل"}`,
            `الكنيات: ${report.nicknameSuccess} ناجح | ` +
            `${report.nicknameSkipped} متخطى | ` +
            `${report.nicknameFailed} فاشل`
        );
    }

    return lines.join("\n");
}

// ==================== أمر اختيار المجموعات ====================

module.exports.config = {
    name: "سجن_الجروب",
    version: "5.0.0",
    hasPermssion: 3,
    credits: "أبو هريرة",
    description: "تغيير أسماء وصور وكنيات المجموعات المحددة",
    commandCategory: "Admin",
    usages: "سجن_الجروب",
    cooldowns: 10
};

module.exports.run = async function ({
    api,
    event,
    Threads
}) {
    const controlThreadID = String(event.threadID);
    const senderID = String(event.senderID);

    if (!isDeveloper(senderID)) {
        return sendToControl(
            api,
            controlThreadID,
            "هذا الأمر مخصص للمطورين المصرح لهم فقط."
        );
    }

    await sendToControl(
        api,
        controlThreadID,
        "جارٍ جلب المجموعات التي يستطيع البوت الوصول إليها..."
    );

    const result = await fetchAllGroups(
        api,
        Threads,
        controlThreadID
    );

    const groups = result.groups;

    if (!groups.length) {
        return sendToControl(
            api,
            controlThreadID,
            "لم أجد مجموعات قابلة للمعالجة. تحقق من صلاحيات API وقائمة المحادثات."
        );
    }

    const shownGroups = groups.slice(0, 80);

    const lines = [
        "⛓️ اختر المجموعات المراد معالجتها",
        "━━━━━━━━━━━━━━━━━━",
        `عدد المجموعات المتاحة: ${groups.length}`,
        "أرسل الأرقام مفصولة بمسافات أو فواصل",
        "مثال: 1 3 5",
        "أرسل الكل لمعالجة كل المجموعات المعروضة",
        "أرسل إلغاء للتراجع",
        "━━━━━━━━━━━━━━━━━━"
    ];

    shownGroups.forEach((group, index) => {
        lines.push(
            `${index + 1}. ${group.threadName} ` +
            `(${group.memberCount} عضو)`
        );
    });

    if (groups.length > shownGroups.length) {
        lines.push(
            `\nتم عرض أول ${shownGroups.length} مجموعة فقط لتجنب طول القائمة.`
        );
    }

    const messageInfo = await new Promise(resolve => {
        api.sendMessage(
            lines.join("\n"),
            controlThreadID,
            (error, info) => {
                if (error) {
                    logError("إرسال قائمة المجموعات", error);
                    return resolve(null);
                }

                resolve(info);
            }
        );
    });

    if (!messageInfo?.messageID) return;

    if (!global.client) global.client = {};
    if (!Array.isArray(global.client.handleReply)) {
        global.client.handleReply = [];
    }

    global.client.handleReply.push({
        name: module.exports.config.name,
        messageID: messageInfo.messageID,
        author: senderID,
        controlThreadID,
        groups: shownGroups
    });
};

// ==================== استقبال الاختيار ====================

module.exports.handleReply = async function ({
    api,
    event,
    handleReply
}) {
    if (String(event.senderID) !== String(handleReply.author)) {
        return;
    }

    if (
        String(event.threadID) !==
        String(handleReply.controlThreadID)
    ) {
        return;
    }

    const body = String(event.body || "").trim();

    const sessions = global.client?.handleReply;

    if (Array.isArray(sessions)) {
        const index = sessions.findIndex(item =>
            item.messageID === handleReply.messageID &&
            item.name === module.exports.config.name
        );

        if (index !== -1) sessions.splice(index, 1);
    }

    if (/^(إلغاء|الغاء|cancel)$/i.test(body)) {
        return sendToControl(
            api,
            handleReply.controlThreadID,
            "تم إلغاء العملية."
        );
    }

    let selectedGroups = [];

    if (/^(الكل|كل|all)$/i.test(body)) {
        selectedGroups = handleReply.groups;
    } else {
        const numbers = body
            .split(/[\s,،]+/)
            .filter(Boolean)
            .map(Number);

        if (
            !numbers.length ||
            numbers.some(number =>
                !Number.isInteger(number) ||
                number < 1 ||
                number > handleReply.groups.length
            )
        ) {
            return sendToControl(
                api,
                handleReply.controlThreadID,
                "اختيار غير صالح. أعد تشغيل الأمر وأرسل أرقامًا صحيحة."
            );
        }

        const uniqueNumbers = [...new Set(numbers)];

        selectedGroups = uniqueNumbers.map(
            number => handleReply.groups[number - 1]
        );
    }

    await sendToControl(
        api,
        handleReply.controlThreadID,
        `بدأت معالجة ${selectedGroups.length} مجموعة.\n` +
        "سيظهر التقرير هنا عند الانتهاء."
    );

    const reports = [];

    // نعالج المجموعات واحدة تلو الأخرى لتقليل الضغط على API.
    for (const group of selectedGroups) {
        const report = await processGroup(api, group);
        reports.push(report);
    }

    await sendToControl(
        api,
        handleReply.controlThreadID,
        formatReport(reports)
    );
};