/**
 * سجن_الجروب.js
 * جلب المجموعات من مصادر البوت واختيار عدة مجموعات
 * تغيير الاسم والكنيات إلى نقطة.
 * التقارير ترسل إلى مجموعة تنفيذ الأمر فقط.
 */

const fs = require("fs");
const path = require("path");

module.exports.config = {
    name: "سجن_الجروب",
    version: "3.0.0",
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
const DATA_DIR = path.join(__dirname, "../../../data");
const LEFT_THREADS_FILE = path.join(DATA_DIR, "leftThreads.json");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
// استدعاء API مع مهلة زمنية
// ==================================================

function callAPI(api, methodName, args = [], timeout = 15000) {
    return new Promise((resolve, reject) => {
        const method = api?.[methodName];

        if (typeof method !== "function") {
            return reject(new Error(`الدالة ${methodName} غير متاحة`));
        }

        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            reject(new Error(`انتهت مهلة ${methodName}`));
        }, timeout);

        const done = (error, result) => {
            if (finished) return;

            finished = true;
            clearTimeout(timer);

            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        };

        try {
            const result = method.call(api, ...args, done);

            if (result && typeof result.then === "function") {
                result.then(
                    value => done(null, value),
                    error => done(error)
                );
            }
        } catch (error) {
            done(error);
        }
    });
}

function sendToControl(api, controlThreadID, message, messageID) {
    return new Promise(resolve => {
        try {
            api.sendMessage(
                message,
                controlThreadID,
                () => resolve(),
                messageID
            );
        } catch (error) {
            console.error("[سجن_الجروب] إرسال التقرير:", error);
            resolve();
        }
    });
}

// ==================================================
// جمع معرّفات المجموعات مثل أمر لاست
// ==================================================

function collectThreadIDs(Threads) {
    const ids = new Set();

    try {
        if (Array.isArray(global.data?.allThreadID)) {
            for (const id of global.data.allThreadID) {
                if (id) ids.add(String(id));
            }
        }
    } catch {}

    try {
        if (global.data?.threadData) {
            for (const id of Object.keys(global.data.threadData)) {
                if (id) ids.add(String(id));
            }
        }
    } catch {}

    try {
        if (Threads?.database) {
            for (const id of Object.keys(Threads.database)) {
                if (id) ids.add(String(id));
            }
        }
    } catch {}

    return ids;
}

// ==================================================
// جلب معلومات مجموعة
// ==================================================

function getThreadInfo(api, threadID) {
    return new Promise((resolve, reject) => {
        if (typeof api?.getThreadInfo !== "function") {
            return reject(new Error("getThreadInfo غير متاحة"));
        }

        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            reject(new Error("انتهت مهلة جلب معلومات المجموعة"));
        }, 12000);

        const done = (error, info) => {
            if (finished) return;

            finished = true;
            clearTimeout(timer);

            if (error || !info) {
                reject(error || new Error("لم تصل معلومات المجموعة"));
            } else {
                resolve(info);
            }
        };

        try {
            const result = api.getThreadInfo(String(threadID), done);

            if (result && typeof result.then === "function") {
                result.then(
                    info => done(null, info),
                    error => done(error)
                );
            }
        } catch (error) {
            done(error);
        }
    });
}

function getGroupName(info, threadID) {
    return info?.threadName || info?.name || `مجموعة ${threadID}`;
}

function isGroupInfo(info) {
    if (!info) return false;

    if (info.isGroup === true) return true;
    if (info.isGroup === false) return false;

    const members = Array.isArray(info.participantIDs)
        ? info.participantIDs.length
        : Array.isArray(info.participants)
            ? info.participants.length
            : 0;

    return members > 2;
}

function getMemberIDs(info) {
    const ids = Array.isArray(info?.participantIDs)
        ? info.participantIDs
        : Array.isArray(info?.participants)
            ? info.participants.map(member =>
                typeof member === "object"
                    ? member.userID || member.id
                    : member
            )
            : [];

    return [...new Set(ids.filter(Boolean).map(String))];
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
    await callAPI(api, "setTitle", [GROUP_NAME, threadID]);

    const info = await getThreadInfo(api, threadID);

    if (info.threadName && info.threadName !== GROUP_NAME) {
        throw new Error("لم يتأكد تغيير اسم المجموعة");
    }

    return true;
}

// ==================================================
// تغيير الكنية إلى نقطة
// ==================================================

async function setNickname(api, threadID, userID) {
    await callAPI(api, "changeNickname", [
        NICKNAME,
        threadID,
        userID
    ]);
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
        name => typeof api[name] === "function"
    );

    if (!methodName) {
        return {
            success: false,
            reason: "لم يتم العثور على دالة حذف صورة مدعومة"
        };
    }

    try {
        await callAPI(api, methodName, [threadID]);

        return { success: true, reason: "" };
    } catch (error) {
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
        console.error("[سجن_الجروب] تغيير الاسم:", threadID, error);
    }

    const imageResult = await removeGroupImage(api, threadID);
    report.image = imageResult.success;
    report.imageReason = imageResult.reason;

    let info;

    try {
        info = await getThreadInfo(api, threadID);
    } catch (error) {
        console.error("[سجن_الجروب] جلب الأعضاء:", threadID, error);
        return report;
    }

    const members = getMemberIDs(info);
    report.members = members.length;

    let pending = [];

    for (const userID of members) {
        const nickname = getNickname(info, userID);

        if (nickname === NICKNAME) {
            report.nicknameSkipped++;
        } else {
            pending.push(userID);
        }
    }

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES && pending.length > 0;
        attempt++
    ) {
        const failedThisRound = [];

        for (const userID of pending) {
            try {
                await setNickname(api, threadID, userID);
                report.nicknameSuccess++;
            } catch (error) {
                failedThisRound.push(userID);

                console.error(
                    `[سجن_الجروب] فشل تغيير الكنية، المحاولة ${attempt}:`,
                    threadID,
                    userID,
                    error
                );
            }

            await sleep(DELAY);
        }

        pending = failedThisRound;

        if (pending.length > 0 && attempt < MAX_RETRIES) {
            await sleep(1000);
        }
    }

    report.nicknameFailed = pending.length;

    return report;
}

// ==================================================
// عرض المجموعات واختيارها
// ==================================================

module.exports.run = async function ({ api, event, Threads }) {
    const controlThreadID = String(event.threadID);
    const senderID = String(event.senderID);
    const messageID = event.messageID;

    if (!getDeveloperIDs().includes(senderID)) {
        return api.sendMessage(
            "هذا الأمر للمطور فقط.",
            controlThreadID,
            messageID
        );
    }

    try {
        const ids = collectThreadIDs(Threads);

        // لا نختبر الاتصال بإرسال رسائل إلى المجموعات.
        // نستخدم getThreadInfo فقط.
        const groups = [];

        for (const id of ids) {
            if (id === controlThreadID) continue;

            try {
                const info = await getThreadInfo(api, id);

                if (!isGroupInfo(info)) continue;

                groups.push({
                    id,
                    name: getGroupName(info, id)
                });
            } catch {
                // تجاهل المحادثات التي تعذر جلب معلوماتها
            }
        }

        if (groups.length === 0) {
            return sendToControl(
                api,
                controlThreadID,
                "لم أجد مجموعات متاحة في مصادر البوت.",
                messageID
            );
        }

        groups.sort((a, b) =>
            a.name.localeCompare(b.name, "ar")
        );

        const shownGroups = groups.slice(0, 50);

        const list = shownGroups.map((group, index) =>
            `${index + 1}. ${group.name}`
        ).join("\n");

        const sent = await new Promise(resolve => {
            api.sendMessage(
                "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
                "اختر المجموعات التي تريد سجنها بإرسال الأرقام مفصولة بمسافات أو فواصل.\n" +
                "مثال: 1 3 5\n\n" +
                list +
                "\n\nأرسل «إلغاء» للتوقف.",
                controlThreadID,
                (error, info) => resolve(error ? null : info),
                messageID
            );
        });

        if (!sent?.messageID) return;

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
        console.error("[سجن_الجروب]", error);

        return sendToControl(
            api,
            controlThreadID,
            "تعذر جلب المجموعات. تحقق من صلاحيات البوت وواجهة API.",
            messageID
        );
    }
};

// ==================================================
// اختيار الأرقام وتنفيذ العملية
// ==================================================

module.exports.handleReply = async function ({
    api,
    event,
    handleReply
}) {
    const controlThreadID = String(event.threadID);
    const senderID = String(event.senderID);
    const messageID = event.messageID;

    if (senderID !== handleReply.author) return;

    if (controlThreadID !== handleReply.controlThreadID) return;

    const removeSession = () => {
        const sessions = global.client.handleReply || [];

        const index = sessions.findIndex(item =>
            item.messageID === handleReply.messageID &&
            item.name === module.exports.config.name
        );

        if (index !== -1) sessions.splice(index, 1);
    };

    const body = String(event.body || "").trim();

    if (body.toLowerCase() === "إلغاء") {
        removeSession();

        return sendToControl(
            api,
            controlThreadID,
            "تم إلغاء العملية.",
            messageID
        );
    }

    const numbers = body
        .split(/[\s,،]+/)
        .filter(Boolean)
        .map(Number);

    if (
        numbers.length === 0 ||
        numbers.some(number =>
            !Number.isInteger(number) ||
            number < 1 ||
            number > handleReply.groups.length
        )
    ) {
        return sendToControl(
            api,
            controlThreadID,
            "الأرقام غير صحيحة. أرسل أرقامًا موجودة في القائمة أو «إلغاء».",
            messageID
        );
    }

    removeSession();

    const selected = [...new Set(numbers)].map(
        number => handleReply.groups[number - 1]
    );

    await sendToControl(
        api,
        controlThreadID,
        `بدأت العملية على ${selected.length} مجموعة. جميع التقارير ستظهر هنا فقط.`,
        messageID
    );

    const results = [];

    for (const group of selected) {
        const report = await processGroup(api, group.id);
        results.push({ group, report });
    }

    const output = results.map(({ group, report }) =>
        `المجموعة: ${group.name}\n` +
        `تغيير الاسم: ${report.title ? "نجح" : "فشل أو لم يُتحقق منه"}\n` +
        `حذف الصورة: ${
            report.image
                ? "نجح"
                : "لم يتم: " + (report.imageReason || "غير مدعوم")
        }\n` +
        `تم إرسال طلب تغيير الكنية: ${report.nicknameSuccess}\n` +
        `تم تجاوز كنيات النقطة: ${report.nicknameSkipped}\n` +
        `فشل بعد إعادة المحاولة: ${report.nicknameFailed}\n` +
        `عدد الأعضاء: ${report.members}`
    ).join("\n\n──────────\n\n");

    return sendToControl(
        api,
        controlThreadID,
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\nانتهت العملية\n\n" + output,
        messageID
    );
};