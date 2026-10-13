/**
 * سجن_الجروب.js
 * جلب المجموعات من مصادر متعددة واختيار عدة مجموعات.
 * تغيير اسم المجموعة والكنيات إلى نقطة.
 * التقارير ترسل إلى مجموعة تنفيذ الأمر فقط.
 */

module.exports.config = {
    name: "سجن_الجروب",
    version: "4.0.0",
    hasPermssion: 2,
    credits: "أبو هريرة",
    description: "اختيار مجموعات وتغيير أسمائها وكنيات أعضائها",
    commandCategory: "developer",
    usages: "سجن_الجروب",
    cooldowns: 30
};

const GROUP_NAME = "شلة السجن قاهرتكم ⛓️🔒";
const NICKNAME = ".";
const MAX_RETRIES = 3;
const DELAY = 350;
const FETCH_TIMEOUT = 15000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function logError(label, error) {
    console.error(
        `[سجن_الجروب] ${label}:`,
        error?.stack || error?.message || error
    );
}

// ==================================================
// صلاحيات المطور
// ==================================================

function getDeveloperIDs() {
    const admins = global.config?.ADMINBOT;
    const devs = global.KIRA_CONF?.dev;

    return [
        ...(Array.isArray(admins) ? admins : admins ? [admins] : []),
        ...(Array.isArray(devs) ? devs : devs ? [devs] : [])
    ].map(String);
}

// ==================================================
// إرسال التقارير إلى مجموعة تنفيذ الأمر فقط
// ==================================================

function sendToControl(api, threadID, message, replyToID) {
    return new Promise(resolve => {
        try {
            api.sendMessage(
                message,
                String(threadID),
                (error, info) => {
                    if (error) logError("sendMessage", error);
                    resolve(info || null);
                },
                replyToID
            );
        } catch (error) {
            logError("sendMessage", error);
            resolve(null);
        }
    });
}

// ==================================================
// استدعاء API مع دعم callback و Promise
// ==================================================

function callAPI(api, methodName, args = [], timeout = FETCH_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const method = api?.[methodName];

        if (typeof method !== "function") {
            return reject(new Error(`${methodName} غير متاحة`));
        }

        let finished = false;

        const timer = setTimeout(() => {
            finish(new Error(`انتهت مهلة ${methodName}`));
        }, timeout);

        function finish(error, result) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);

            if (error) reject(error);
            else resolve(result);
        }

        try {
            const result = method.call(api, ...args, (error, data) => {
                if (error) return finish(error);
                finish(null, data);
            });

            if (result && typeof result.then === "function") {
                result.then(
                    value => finish(null, value),
                    error => finish(error)
                );
            } else if (
                result &&
                typeof result === "object" &&
                (
                    Array.isArray(result) ||
                    result.threadID ||
                    result.threadName ||
                    result.participantIDs
                )
            ) {
                finish(null, result);
            }
        } catch (error) {
            finish(error);
        }
    });
}

// ==================================================
// استخراج معرّفات المحادثات
// ==================================================

function extractID(item) {
    if (item === null || item === undefined) return null;

    if (typeof item === "string" || typeof item === "number") {
        const id = String(item).trim();
        return id || null;
    }

    if (typeof item === "object") {
        const id =
            item.threadID ??
            item.threadId ??
            item.thread_id ??
            item.id;

        if (id !== undefined && id !== null) {
            return String(id);
        }
    }

    return null;
}

function addSourceToSet(source, ids) {
    if (!source) return;

    if (Array.isArray(source)) {
        for (const item of source) {
            const id = extractID(item);
            if (id) ids.add(id);
        }
        return;
    }

    if (source instanceof Map) {
        for (const key of source.keys()) {
            if (key !== undefined && key !== null) {
                ids.add(String(key));
            }
        }
        return;
    }

    if (typeof source === "object") {
        for (const key of Object.keys(source)) {
            const id = extractID(source[key]);

            // مفاتيح threadData و Threads.database عادة هي معرّفات المحادثات.
            if (key) ids.add(String(key));
            if (id) ids.add(id);
        }
    }
}

function collectThreadIDs(Threads) {
    const ids = new Set();

    try {
        addSourceToSet(global.data?.allThreadID, ids);
        addSourceToSet(global.data?.threadData, ids);
        addSourceToSet(Threads?.database, ids);
    } catch (error) {
        logError("collectThreadIDs", error);
    }

    return ids;
}

// ==================================================
// جلب قائمة المحادثات بعدة صيغ
// ==================================================

async function fetchThreadList(api) {
    const methods = [
        {
            name: "getThreadList",
            args: [100, null, ["INBOX"]]
        },
        {
            name: "getThreadList",
            args: [100, null, []]
        },
        {
            name: "getThreadListDeprecated",
            args: [100, null, ["INBOX"]]
        },
        {
            name: "getThreadListDeprecated",
            args: [100, null, []]
        }
    ];

    for (const attempt of methods) {
        if (typeof api?.[attempt.name] !== "function") {
            console.log(
                `[سجن_الجروب] ${attempt.name} غير موجودة`
            );
            continue;
        }

        try {
            const result = await callAPI(
                api,
                attempt.name,
                attempt.args,
                20000
            );

            if (Array.isArray(result)) {
                console.log(
                    `[سجن_الجروب] ${attempt.name}: ${result.length} محادثة`
                );

                if (result.length) return result;
            }
        } catch (error) {
            logError(attempt.name, error);
        }
    }

    return [];
}

// ==================================================
// جلب معلومات محادثة واحدة
// ==================================================

async function getThreadInfo(api, threadID) {
    const methods = [
        {
            name: "getThreadInfo",
            args: [String(threadID)]
        }
    ];

    for (const attempt of methods) {
        try {
            const info = await callAPI(
                api,
                attempt.name,
                attempt.args,
                FETCH_TIMEOUT
            );

            if (info && typeof info === "object") {
                return info;
            }
        } catch (error) {
            logError(`${attempt.name}(${threadID})`, error);
        }
    }

    return null;
}

// ==================================================
// التعرف على المجموعات والأعضاء
// ==================================================

function getMemberIDs(info) {
    if (!info) return [];

    let members = [];

    if (Array.isArray(info.participantIDs)) {
        members = info.participantIDs;
    } else if (Array.isArray(info.participants)) {
        members = info.participants.map(member =>
            typeof member === "object"
                ? member.userID || member.id || member.userFbId
                : member
        );
    }

    return [...new Set(
        members
            .filter(id => id !== null && id !== undefined)
            .map(String)
    )];
}

function isGroupInfo(info) {
    if (!info || typeof info !== "object") return false;

    if (info.isGroup === true) return true;
    if (info.isGroup === false) return false;

    return getMemberIDs(info).length > 2;
}

function getGroupName(info, threadID) {
    return info?.threadName ||
        info?.name ||
        `مجموعة ${threadID}`;
}

// ==================================================
// الجلب الرئيسي: المصادر + قائمة المحادثات
// ==================================================

async function fetchAllGroups(api, Threads, controlThreadID) {
    const ids = collectThreadIDs(Threads);
    const list = await fetchThreadList(api);

    for (const item of list) {
        const id = extractID(item);
        if (id) ids.add(id);
    }

    // لا نختار مجموعة تنفيذ الأمر ضمن المجموعات المستهدفة.
    ids.delete(String(controlThreadID));

    const groups = [];
    let failed = 0;
    let processed = 0;

    for (const id of ids) {
        processed++;

        let info = await getThreadInfo(api, id);

        // استخدام عنصر القائمة احتياطيًا إن تعذر جلب التفاصيل.
        if (!info) {
            const item = list.find(
                entry => extractID(entry) === String(id)
            );

            if (item && isGroupInfo(item)) {
                info = item;
            } else {
                failed++;
                continue;
            }
        }

        if (!isGroupInfo(info)) continue;

        groups.push({
            id: String(id),
            name: getGroupName(info, id)
        });
    }

    groups.sort((a, b) =>
        a.name.localeCompare(b.name, "ar")
    );

    console.log(
        `[سجن_الجروب] الجلب انتهى: ` +
        `المعرفات=${ids.size}, ` +
        `المجموعات=${groups.length}, ` +
        `الفشل=${failed}`
    );

    return {
        groups,
        failed,
        checked: processed,
        listCount: list.length
    };
}

// ==================================================
// قراءة الكنيات
// ==================================================

function getNickname(info, userID) {
    const nicknames = info?.nicknames;

    if (!nicknames) return undefined;

    if (Array.isArray(nicknames)) {
        const item = nicknames.find(entry =>
            String(entry.userID || entry.id) === String(userID)
        );

        return item?.nickname;
    }

    return nicknames[String(userID)];
}

// ==================================================
// تغيير اسم المجموعة
// ==================================================

async function setGroupTitle(api, threadID) {
    await callAPI(
        api,
        "setTitle",
        [GROUP_NAME, String(threadID)]
    );

    // التحقق من الاسم إذا أمكن جلب المعلومات مجددًا.
    const info = await getThreadInfo(api, threadID);

    if (
        info?.threadName &&
        info.threadName !== GROUP_NAME
    ) {
        throw new Error("اسم المجموعة لم يتطابق بعد التغيير");
    }

    return true;
}

// ==================================================
// تغيير الكنية إلى نقطة
// ==================================================

async function setNickname(api, threadID, userID) {
    await callAPI(
        api,
        "changeNickname",
        [NICKNAME, String(threadID), String(userID)]
    );
}

// ==================================================
// حذف صورة المجموعة إذا كانت المكتبة تدعم ذلك
// ==================================================

async function removeGroupImage(api, threadID) {
    const candidates = [
        "removeGroupImage",
        "deleteGroupImage",
        "removeThreadImage",
        "deleteThreadImage"
    ];

    const methodName = candidates.find(
        name => typeof api?.[name] === "function"
    );

    if (!methodName) {
        return {
            success: false,
            reason: "لا توجد دالة حذف صورة معروفة في واجهة API"
        };
    }

    try {
        await callAPI(api, methodName, [String(threadID)]);

        return {
            success: true,
            reason: ""
        };
    } catch (error) {
        logError(`حذف الصورة ${threadID}`, error);

        return {
            success: false,
            reason: error.message || String(error)
        };
    }
}

// ==================================================
// معالجة مجموعة واحدة
// ==================================================

async function processGroup(api, threadID) {
    const report = {
        title: false,
        image: false,
        imageReason: "",
        nicknameSuccess: 0,
        nicknameSkipped: 0,
        nicknameFailed: 0,
        members: 0
    };

    try {
        await setGroupTitle(api, threadID);
        report.title = true;
    } catch (error) {
        logError(`تغيير الاسم ${threadID}`, error);
    }

    const imageResult = await removeGroupImage(api, threadID);
    report.image = imageResult.success;
    report.imageReason = imageResult.reason;

    let info;

    try {
        info = await getThreadInfo(api, threadID);

        if (!info) {
            throw new Error("تعذر جلب معلومات الأعضاء");
        }
    } catch (error) {
        logError(`جلب أعضاء ${threadID}`, error);
        return report;
    }

    const members = getMemberIDs(info);
    report.members = members.length;

    const pending = [];

    for (const userID of members) {
        if (getNickname(info, userID) === NICKNAME) {
            report.nicknameSkipped++;
        } else {
            pending.push(userID);
        }
    }

    let remaining = pending;

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES && remaining.length > 0;
        attempt++
    ) {
        const failedThisRound = [];

        for (const userID of remaining) {
            try {
                await setNickname(api, threadID, userID);
                report.nicknameSuccess++;
            } catch (error) {
                failedThisRound.push(userID);

                logError(
                    `تغيير الكنية ${threadID}/${userID} محاولة ${attempt}`,
                    error
                );
            }

            await sleep(DELAY);
        }

        remaining = failedThisRound;

        if (remaining.length && attempt < MAX_RETRIES) {
            await sleep(1000);
        }
    }

    report.nicknameFailed = remaining.length;

    return report;
}

// ==================================================
// تنفيذ الأمر وعرض قائمة المجموعات
// ==================================================

module.exports.run = async function ({ api, event, Threads }) {
    const controlThreadID = String(event.threadID);
    const senderID = String(event.senderID);

    if (!getDeveloperIDs().includes(senderID)) {
        return sendToControl(
            api,
            controlThreadID,
            "هذا الأمر للمطور فقط.",
            event.messageID
        );
    }

    try {
        const result = await fetchAllGroups(
            api,
            Threads,
            controlThreadID
        );

        if (!result.groups.length) {
            return sendToControl(
                api,
                controlThreadID,
                "لم أتمكن من العثور على أي مجموعة.\n\n" +
                `المعرفات المفحوصة: ${result.checked}\n` +
                `المحادثات التي أرجعتها القائمة: ${result.listCount}\n` +
                `عمليات الجلب الفاشلة: ${result.failed}\n\n` +
                "افحص سجل البوت بحثًا عن أخطاء [سجن_الجروب].",
                event.messageID
            );
        }

        const shownGroups = result.groups.slice(0, 50);

        const list = shownGroups.map((group, index) =>
            `${index + 1}. ${group.name}`
        ).join("\n");

        const sent = await sendToControl(
            api,
            controlThreadID,
            "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
            "اختر المجموعات بإرسال الأرقام مفصولة بمسافات أو فواصل.\n" +
            "مثال: 1 3 5\n\n" +
            list +
            "\n\nأرسل «إلغاء» للتوقف.\n" +
            `\nالمجموعات المعروضة: ${shownGroups.length}` +
            `\nتعذر جلب تفاصيل ${result.failed} محادثة.`,
            event.messageID
        );

        if (!sent?.messageID) {
            console.log(
                "[سجن_الجروب] لم أستطع الحصول على messageID للقائمة."
            );
            return;
        }

        if (!Array.isArray(global.client.handleReply)) {
            global.client.handleReply = [];
        }

        global.client.handleReply.push({
            name: module.exports.config.name,
            messageID: sent.messageID,
            author: senderID,
            controlThreadID,
            groups: shownGroups
        });
    } catch (error) {
        logError("run", error);

        return sendToControl(
            api,
            controlThreadID,
            "حدث خطأ أثناء جلب المجموعات. راجع سجل البوت لمعرفة السبب.",
            event.messageID
        );
    }
};

// ==================================================
// استقبال اختيار الأرقام
// ==================================================

module.exports.handleReply = async function ({
    api,
    event,
    handleReply
}) {
    const controlThreadID = String(event.threadID);
    const senderID = String(event.senderID);
    const body = String(event.body || "").trim();

    if (senderID !== String(handleReply.author)) return;
    if (controlThreadID !== String(handleReply.controlThreadID)) return;

    function removeSession() {
        const sessions = global.client.handleReply || [];

        const index = sessions.findIndex(item =>
            item.messageID === handleReply.messageID &&
            item.name === module.exports.config.name
        );

        if (index !== -1) sessions.splice(index, 1);
    }

    if (body === "إلغاء" || body.toLowerCase() === "cancel") {
        removeSession();

        return sendToControl(
            api,
            controlThreadID,
            "تم إلغاء العملية.",
            event.messageID
        );
    }

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
            controlThreadID,
            "الاختيار غير صحيح. أرسل أرقامًا من القائمة أو «إلغاء».",
            event.messageID
        );
    }

    removeSession();

    const selected = [...new Set(numbers)].map(
        number => handleReply.groups[number - 1]
    );

    await sendToControl(
        api,
        controlThreadID,
        `بدأت العملية على ${selected.length} مجموعة.\nستظهر التقارير هنا فقط.`,
        event.messageID
    );

    const results = [];

    for (const group of selected) {
        const report = await processGroup(api, group.id);
        results.push({ group, report });
    }

    const output = results.map(({ group, report }) =>
        `المجموعة: ${group.name}\n` +
        `تغيير الاسم: ${report.title ? "نجح" : "فشل أو لم يمكن التحقق"}\n` +
        `حذف الصورة: ${
            report.image
                ? "نجح"
                : "لم يتم (" + (report.imageReason || "غير معروف") + ")"
        }\n` +
        `طلبات تغيير الكنية الناجحة: ${report.nicknameSuccess}\n` +
        `تم تجاوز كنيات النقطة: ${report.nicknameSkipped}\n` +
        `فشل بعد إعادة المحاولة: ${report.nicknameFailed}\n` +
        `عدد الأعضاء المقروء: ${report.members}`
    ).join("\n\n──────────\n\n");

    return sendToControl(
        api,
        controlThreadID,
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\nانتهت العملية.\n\n" + output,
        event.messageID
    );
};